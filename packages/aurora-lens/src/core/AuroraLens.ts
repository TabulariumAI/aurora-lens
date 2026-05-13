import { assertContainer, assertFile, assertPageIndex } from "./inputs";
import { MetadataRepository } from "./MetadataRepository";
import { MetadataHelper } from "./MetadataHelper";
import { PageViewer } from "./PageViewer";
import { ACTIVE_VIEWER_SESSION_ID, reorderPageRecords } from "./viewerSessionStore";
import { DECODER_ERROR_PAGE_OUT_OF_RANGE, DECODER_ERROR_PAGE_SIZE, DecoderError } from "./DecoderError";
import { DocumentDecoder } from "./documentDecoder/DocumentDecoder";
import { normalizeSelectionTheme } from "./selectionTheme";
import { SelectionManager } from "./SelectionManager";
import { ThumbnailViewer } from "./ThumbnailViewer";
import { exportTiffPages } from "./TiffExporter";
import { validateRasterPageSize, type PageSizeConfig } from "./pageSizeValidation";
import { defaultViewerConfig, type ViewerConfig } from "./viewerConfig";
import type { DecodedPage as DecodedDocPage } from "./documentDecoder/types";
import type {
  ViewerOptions,
  ViewerState,
  ViewerStatus,
  ViewMode,
  CopySelectionResult,
  DecodedPage,
  PageMetadataHits,
  PagePoint,
  RasterPage,
  ViewerPageBlobRecord,
  ViewerPageRecord,
  ViewerSessionStore,
} from "./types";

const RESTORE_ERROR_MESSAGE = "Could not restore the previous viewer session.";
const TIFF_FILE_TYPE = "image/tiff";

interface RenderedPage extends DecodedPage {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  blob: Blob;
  sourcePageIndex: number;
}

interface ThumbnailPage extends DecodedPage {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
}

interface ThumbnailReorderRequest {
  fromPageIndex: number;
  toPageIndex: number;
}

interface ImportedPage extends RasterPage {
  sourceType: DecodedDocPage["sourceType"];
  xResolution: number;
  yResolution: number;
  documentType: string;
  physicalWidth: number;
  physicalHeight: number;
}

export class AuroraLens {
  private readonly metadata = new MetadataHelper();
  private readonly metadataRepository = new MetadataRepository();
  private readonly selection: SelectionManager;
  private readonly decoder = new DocumentDecoder();
  private readonly sessionStore: ViewerSessionStore | null;
  private readonly pageViewer: PageViewer;
  private readonly thumbnailViewer: ThumbnailViewer;
  private file: File | null = null;
  private page: RenderedPage | null = null;
  private metadataInput: unknown | null = null;
  private metadataPending = false;
  private sessionPages: ViewerPageRecord[] = [];
  private metadataPageIds = new Set<string>();
  private memoryBlobs = new Map<string, Blob>();
  private thumbnails: Array<ThumbnailPage | undefined> = [];
  private thumbnailJobs = new Set<number>();
  private thumbnailKeep = new Set<number>();
  private storedPageIds = new Set<string>();
  private thumbnailRun = 0;
  private persistenceRun = 0;
  private viewMode: ViewMode = "page";
  private status: ViewerStatus = "idle";
  private coordinates: PagePoint | null = null;
  private displayCoordinates: PagePoint | null = null;
  private pageCount = 0;
  private runId = 0;

  constructor(private readonly container: HTMLElement, private readonly options: ViewerOptions) {
    assertContainer(container);
    this.sessionStore = options.sessionStore ?? null;
    this.selection = new SelectionManager(normalizeSelectionTheme(options.selectionTheme));
    this.pageViewer = new PageViewer({
      metadata: this.metadata,
      selection: this.selection,
      onChange: () => this.emitState(),
      onCoordinates: (coordinates, displayCoordinates) => {
        this.coordinates = coordinates;
        this.displayCoordinates = displayCoordinates;
        this.emitState();
      },
    });
    this.thumbnailViewer = new ThumbnailViewer({
      allowEdit: options.allowEdit,
      onAdd: (files, insertIndex) => this.addPages(files, insertIndex),
      onRange: (pageIndexes) => {
        this.loadThumbnails(pageIndexes);
      },
      onReorder: (request) => this.reorderPages(request),
      onSelect: (pageIndex) => {
        void Promise.resolve(this.goPage(pageIndex)).catch(() => undefined);
      },
    });
    this.mount();
    this.emitStatus();
    this.emitState();
  }

  close(): void {
    this.decoder.close();
    this.clearView();
  }

  clear(): void {
    this.clearView();
    void this.deleteSession().catch(() => undefined);
  }

  private clearView(): void {
    this.runId += 1;
    this.persistenceRun += 1;
    this.revokePage();
    this.revokeThumbnails();
    this.file = null;
    this.pageCount = 0;
    this.viewMode = "page";
    this.status = "idle";
    this.coordinates = null;
    this.displayCoordinates = null;
    this.metadataInput = null;
    this.metadataPending = false;
    this.sessionPages = [];
    this.metadataPageIds = new Set();
    this.memoryBlobs = new Map();
    this.storedPageIds = new Set();
    this.metadata.clear();
    this.pageViewer.clear();
    this.thumbnailViewer.clear();
    this.showView("page");
    this.emitStatus();
    this.emitState();
  }

  loadMetadata(pageMetadata: unknown): void {
    this.metadataInput = pageMetadata;
    this.metadataPending = true;
    this.metadata.load(pageMetadata);
    if (this.sessionPages.length) {
      void this.saveMetadataPages(pageMetadata).then(() => this.loadCurrentPageMetadata()).catch((error: unknown) => this.fail(error));
    }
    this.emitState();
  }

  async restoreSession(): Promise<boolean> {
    if (!this.sessionStore) {
      return false;
    }

    const restoreRun = this.runId;
    try {
      const session = await this.sessionStore.read();
      if (restoreRun !== this.runId) {
        return false;
      }
      if (!session) {
        return false;
      }

      this.clearView();
      this.sessionPages = session.pages;
      this.metadataPageIds = await this.sessionStore.readPageMetadataIds();
      this.storedPageIds = new Set(session.pages.map((page) => page.pageId));
      this.file = new File([session.document.fileBlob], session.document.fileName, { type: session.document.fileType || TIFF_FILE_TYPE });
      await this.loadPage(this.pagePosition(session.currentPage.pageId), {
        loadMetadata: true,
        saveCurrentPage: true,
        setReady: true,
      });
      return true;
    } catch {
      this.clearView();
      await this.deleteSession().catch(() => undefined);
      this.options.onError?.(new Error(RESTORE_ERROR_MESSAGE));
      return false;
    }
  }

  async decodeDoc(file: File, pageIndex: number): Promise<void> {
    assertFile(file);
    assertPageIndex(pageIndex);
    const openRun = this.runId + 1;
    this.runId = openRun;
    try {
      this.persistenceRun += 1;
      this.revokePage();
      this.revokeThumbnails();
      this.file = file;
      this.pageCount = 0;
      this.sessionPages = [];
      this.metadataPageIds = new Set();
      this.memoryBlobs = new Map();
      this.storedPageIds = new Set();
      this.selection.clear();
      if (!this.metadataPending) {
        this.metadataInput = null;
        this.metadata.clear();
      }
      this.setStatus("loadingPage");

      const config = await this.readViewerConfig();
      let firstReady = false;
      let resolveFirst: () => void = () => undefined;
      let rejectFirst: (error: unknown) => void = () => undefined;
      const firstPage = new Promise<void>((resolve, reject) => {
        resolveFirst = resolve;
        rejectFirst = reject;
      });

      const done = this.decoder.decodeDoc(file, {
        pageCount: async (count) => {
          if (pageIndex >= count) {
            throw new DecoderError(DECODER_ERROR_PAGE_OUT_OF_RANGE, `Page ${pageIndex + 1} is outside the available page range.`);
          }
          const updatedAt = Date.now();
          this.sessionPages = this.createPageRecords(count, updatedAt);
          this.pageCount = count;
          if (this.sessionStore) {
            this.sessionPages = await this.sessionStore.resetDocument({
              fileName: file.name,
              fileType: file.type,
              fileBlob: file,
              pages: this.sessionPages,
              pageCount: count,
              currentPageIndex: pageIndex,
              updatedAt,
            });
          }
        },
        pageReady: async (page) => {
          if (openRun !== this.runId) {
            return;
          }
          const record = this.sessionPages[page.pageIndex];
          if (!record) {
            return;
          }
          const currentIndex = this.pagePosition(record.pageId);
          const importedPage = this.validateImportPage(page, page.pageIndex, config);
          const blob = await this.toBlob(importedPage, importedPage.width, importedPage.height);
          await this.savePageBlob(currentIndex, blob, Date.now(), importedPage);
          this.storedPageIds.add(record.pageId);
          await this.savePageMetadata(record.pageId, Date.now());
          this.thumbnails[currentIndex] = this.toThumbnailPage(importedPage, currentIndex, blob);
          if (this.viewMode === "thumbnails") {
            this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
          }
          if (page.pageIndex === pageIndex && !firstReady) {
            const rendered = await this.toPage(importedPage, undefined, currentIndex, blob);
            if (openRun !== this.runId) {
              URL.revokeObjectURL(rendered.url);
              return;
            }
            this.revokePage();
            this.page = rendered;
            this.viewMode = "page";
            this.coordinates = null;
            this.displayCoordinates = null;
            this.selection.clear();
            this.showView("page");
            await this.loadStoredPageMetadata(rendered.pageId, rendered.pageIndex);
            this.pageViewer.show(rendered);
            await this.saveCurrentPage(rendered.pageId);
            this.metadataPending = false;
            firstReady = true;
            this.setStatus("ready");
            resolveFirst();
          }
        },
      }, config.view).catch((error: unknown) => {
        if (!firstReady) {
          rejectFirst(error);
          return;
        }
        if (openRun === this.runId) {
          void this.failStoredDocumentPersistence(error);
        }
      });

      await firstPage;
      void done;
    } catch (error) {
      await this.deleteSession().catch(() => undefined);
      this.clearView();
      throw error;
    }
  }

  async addPages(files: File[] | FileList, insertIndex: number): Promise<void> {
    const inputFiles = Array.from(files);
    inputFiles.forEach(assertFile);
    if (!this.file || !this.page || !this.sessionPages.length) {
      throw new Error("AuroraLens.addPages: open a document before adding pages.");
    }
    if (!this.sessionStore) {
      throw new Error("AuroraLens.addPages: package-owned storage is required.");
    }
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > this.sessionPages.length) {
      throw new Error("AuroraLens.addPages: insertIndex must be between 0 and the current page count.");
    }
    if (!inputFiles.length) {
      return;
    }

    this.persistenceRun += 1;
    this.setStatus("loadingPage");
    let records: ViewerPageRecord[] = [];
    try {
      const config = await this.readViewerConfig();
      await this.decoder.decodeDocs(inputFiles, {
        pageCount: async (count) => {
          const updatedAt = Date.now();
          records = this.createPageRecords(count, updatedAt);
          this.sessionPages = await this.sessionStore!.insertPages(insertIndex, records, [], updatedAt);
          this.pageCount = this.sessionPages.length;
          this.insertEmptyThumbnails(insertIndex, count);
          await this.refreshCurrentPageOrder();
          if (this.viewMode === "thumbnails") {
            this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
          }
        },
        pageReady: async (page, importIndex) => {
          const record = records[importIndex];
          if (!record) {
            throw new Error("AuroraLens.addPages: decoder emitted a page before the page count.");
          }
          const updatedAt = Date.now();
          const importedPage = this.validateImportPage(page, importIndex, config);
          const pageIndex = this.pagePosition(record.pageId);
          const blob = await this.toBlob(importedPage, importedPage.width, importedPage.height);
          await this.savePageBlob(pageIndex, blob, updatedAt, importedPage);
          this.storedPageIds.add(record.pageId);
          this.thumbnails[pageIndex] = this.toThumbnailPage(importedPage, pageIndex, blob);
          if (this.viewMode === "thumbnails") {
            this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
          }
        },
      }, config.view);
      this.setStatus("ready");
    } catch (error) {
      await this.removeImportedPages(records);
      this.setStatus("ready");
      this.options.onAddError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  actualSize(): void {
    this.pageViewer.actualSize();
  }

  clearSelection(): void {
    this.pageViewer.clearSelection();
    this.emitState();
  }

  setAllowEdit(allowEdit: boolean): void {
    this.thumbnailViewer.setAllowEdit(allowEdit);
  }

  async readViewerConfig(): Promise<ViewerConfig> {
    if (!this.sessionStore) {
      return defaultViewerConfig();
    }
    return this.sessionStore.readViewerConfig();
  }

  async saveViewerConfig(config: ViewerConfig): Promise<ViewerConfig> {
    if (!this.sessionStore) {
      return {
        formats: config.formats.map((format) => ({ ...format })),
        tolerance: config.tolerance,
        view: { ...config.view },
        export: {
          ...config.export,
          tiff: { ...config.export.tiff },
        },
      };
    }
    const saved = await this.sessionStore.saveViewerConfig(config);
    const file = this.file;
    const pageIndex = this.page?.pageIndex;
    if (file && pageIndex !== undefined) {
      if (this.metadataInput !== null) {
        this.metadataPending = true;
      }
      await this.decodeDoc(file, pageIndex);
    }
    return saved;
  }

  async exportTiff(): Promise<Blob> {
    if (!this.sessionStore || !this.sessionPages.length) {
      throw new Error("AuroraLens.exportTiff: open a document before exporting.");
    }
    const config = await this.readViewerConfig();
    const pages: ViewerPageBlobRecord[] = [];
    for (const page of this.sessionPages) {
      const record = await this.sessionStore.readPageBlobRecord(page.pageId);
      if (!record) {
        throw new Error("AuroraLens.exportTiff: document pages are not ready.");
      }
      pages.push(record);
    }
    return exportTiffPages(pages, config.export);
  }

  async copySelection(): Promise<CopySelectionResult> {
    if (!this.page || !this.selection.hasTokens()) {
      return {
        copied: false,
        groups: [],
        text: "",
      };
    }
    this.setStatus("copyingSelection");
    try {
      const groups = this.metadata.exportGroups(this.page.pageIndex, this.selection.tokens());
      const text = JSON.stringify(groups, null, 2);
      await navigator.clipboard.writeText(text);
      this.setStatus("ready");
      return {
        copied: true,
        groups,
        text,
      };
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  fitHeight(): void {
    this.pageViewer.fitHeight();
  }

  fitPage(): void {
    this.pageViewer.fitPage();
  }

  fitWidth(): void {
    this.pageViewer.fitWidth();
  }

  search(text: string, options?: { additive?: boolean }): PageMetadataHits | null {
    if (!this.page || !this.metadata.hasPage(this.page.pageIndex)) {
      return null;
    }
    const hits = this.metadata.search(this.page.pageIndex, text);
    if (hits.tokens.length || hits.figures.length) {
      if (options?.additive) {
        this.selection.showElements(hits);
      } else {
        this.selection.showElement(hits);
      }
      this.pageViewer.render();
      this.emitState();
    }
    return hits;
  }

  setDrawMode(enabled: boolean): void {
    this.pageViewer.setDrawMode(enabled);
  }

  zoomIn(): void {
    this.pageViewer.zoomIn();
  }

  zoomOut(): void {
    this.pageViewer.zoomOut();
  }

  firstPage(): Promise<void> | void {
    return this.goPage(0);
  }

  lastPage(): Promise<void> | void {
    return this.goPage(this.pageCount - 1);
  }

  nextPage(): Promise<void> | void {
    return this.goPage(this.state().pageIndex + 1);
  }

  previousPage(): Promise<void> | void {
    return this.goPage(this.state().pageIndex - 1);
  }

  goToPage(pageNumber: number): Promise<void> | void {
    assertPageIndex(pageNumber);
    return this.goPage(pageNumber);
  }

  async showThumbnails(): Promise<void> {
    if (!this.file || !this.page || !this.pageCount) {
      return;
    }
    this.thumbnailRun += 1;
    this.thumbnailKeep = new Set();
    this.viewMode = "thumbnails";
    this.thumbnailViewer.show(this.pageIds(), this.pageCount, this.page.sourceName, this.page, this.thumbnails, this.page.pageIndex, this.thumbnailMetadata());
    this.showView("thumbnails");
    this.setStatus("ready");
  }

  private mount() {
    this.container.innerHTML = "";
    Object.assign(this.container.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      maxHeight: "100%",
      minWidth: "0",
      minHeight: "0",
      overflow: "hidden",
    });
    this.container.append(this.pageViewer.element(), this.thumbnailViewer.element());
    this.showView("page");
  }

  private async goPage(pageIndex: number) {
    if (pageIndex < 0 || pageIndex >= this.pageCount) {
      return;
    }
    await this.loadPage(pageIndex, {
      loadMetadata: true,
      saveCurrentPage: true,
      setReady: true,
    });
  }

  private async loadPage(pageIndex: number, options: { loadMetadata: boolean; saveCurrentPage: boolean; setReady: boolean }): Promise<RenderedPage | null> {
    if (!this.file) {
      return null;
    }
    const runId = this.runId + 1;
    this.runId = runId;
    this.setStatus("loadingPage");
    const raster = await this.loadStoredRaster(pageIndex);
    if (!raster) {
      return null;
    }
    const page = await this.toPage(raster, undefined, pageIndex);
    if (runId !== this.runId) {
      URL.revokeObjectURL(page.url);
      return null;
    }
    if (options.loadMetadata) {
      await this.loadStoredPageMetadata(page.pageId, page.pageIndex);
    }
    this.revokePage();
    this.page = page;
    this.pageCount = page.pageCount;
    this.viewMode = "page";
    this.coordinates = null;
    this.displayCoordinates = null;
    this.selection.clear();
    this.showView("page");
    this.pageViewer.show(page);
    this.revokeThumbnails();
    if (options.saveCurrentPage) {
      await this.saveCurrentPage(page.pageId);
    }
    if (options.setReady) {
      this.setStatus("ready");
    }
    return page;
  }

  private showView(viewMode: ViewMode) {
    this.pageViewer.element().style.display = viewMode === "page" ? "block" : "none";
    this.thumbnailViewer.element().style.display = viewMode === "thumbnails" ? "grid" : "none";
  }

  private revokePage() {
    if (this.page) {
      URL.revokeObjectURL(this.page.url);
      this.page = null;
    }
  }

  private revokeThumbnails() {
    this.thumbnailRun += 1;
    this.thumbnailJobs.clear();
    this.thumbnailKeep = new Set();
    this.thumbnails.forEach((thumbnail) => {
      if (thumbnail) {
        URL.revokeObjectURL(thumbnail.url);
      }
    });
    this.thumbnails = [];
  }

  private loadThumbnails(pageIndexes: number[]) {
    const file = this.file;
    if (!file || this.viewMode !== "thumbnails") {
      return;
    }
    const run = this.thumbnailRun;
    const keep = new Set(pageIndexes);
    this.thumbnailKeep = keep;
    this.revokeSkipped(keep);
    const size = this.thumbnailViewer.thumbnailSize();
    pageIndexes.forEach((pageIndex) => {
      if (this.thumbnails[pageIndex] || this.thumbnailJobs.has(pageIndex)) {
        return;
      }
      this.thumbnailJobs.add(pageIndex);
      this.loadStoredRaster(pageIndex).then((page) => page ? this.toPage(page, size, pageIndex) : null).then((thumbnail) => {
        this.thumbnailJobs.delete(pageIndex);
        if (!thumbnail) {
          return;
        }
        if (run !== this.thumbnailRun || this.viewMode !== "thumbnails" || !this.thumbnailKeep.has(pageIndex)) {
          URL.revokeObjectURL(thumbnail.url);
          return;
        }
        this.thumbnails[pageIndex] = thumbnail;
        this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
        this.revokeSkipped(this.thumbnailKeep);
      }).catch((error: unknown) => {
        this.thumbnailJobs.delete(pageIndex);
        if (run === this.thumbnailRun) {
          this.fail(error);
        }
      });
    });
  }

  private revokeSkipped(keep: Set<number>) {
    this.thumbnails.forEach((thumbnail, index) => {
      if (thumbnail && !keep.has(index)) {
        URL.revokeObjectURL(thumbnail.url);
        this.thumbnails[index] = undefined;
      }
    });
  }

  private thumbnailMetadata() {
    return new Set(this.metadataPageIds);
  }

  private setStatus(status: ViewerStatus) {
    this.status = status;
    this.emitStatus();
    this.emitState();
  }

  private fail(error: unknown) {
    const value = error instanceof Error ? error : new Error(String(error));
    this.status = "error";
    this.emitStatus();
    this.emitState();
    this.options.onError?.(value);
  }

  private emitStatus() {
    this.options.onStatusChange?.(this.status);
  }

  private emitState() {
    this.options.onStateChange?.(this.state());
  }

  private async savePageBlob(pageIndex: number, blob: Blob, updatedAt: number, raster: ImportedPage) {
    const record = this.sessionPages[pageIndex];
    if (record) {
      this.memoryBlobs.set(record.pageId, blob);
    }
    if (this.sessionStore && record) {
      await this.sessionStore.savePageBlob({
        pageId: record.pageId,
        blob,
        sourceType: raster.sourceType,
        width: raster.width,
        height: raster.height,
        xResolution: raster.xResolution,
        yResolution: raster.yResolution,
        documentType: raster.documentType,
        physicalWidth: raster.physicalWidth,
        physicalHeight: raster.physicalHeight,
        updatedAt,
      });
    }
  }

  private async saveMetadataPages(pageMetadata: unknown) {
    if (!this.sessionStore) {
      return;
    }
    const updatedAt = Date.now();
    const pages = this.metadataRepository.split(pageMetadata, this.sessionPages);
    for (const page of pages) {
      await this.sessionStore.savePageMetadata({
        pageId: page.pageId,
        metadata: page.metadata,
        updatedAt,
      });
      this.metadataPageIds.add(page.pageId);
    }
  }

  private async savePageMetadata(pageId: string, updatedAt: number) {
    if (!this.sessionStore || this.metadataInput === null) {
      return;
    }
    const record = this.metadataRepository.split(this.metadataInput, this.sessionPages)
      .find((page) => page.pageId === pageId);
    if (!record) {
      return;
    }
    await this.sessionStore.savePageMetadata({
      pageId: record.pageId,
      metadata: record.metadata,
      updatedAt,
    });
    this.metadataPageIds.add(record.pageId);
  }

  private async loadCurrentPageMetadata() {
    if (this.page) {
      await this.loadStoredPageMetadata(this.page.pageId, this.page.pageIndex);
    }
  }

  private async loadStoredPageMetadata(pageId: string, pageIndex: number) {
    if (!this.sessionStore) {
      return;
    }
    this.metadata.clear();
    const metadata = await this.sessionStore.readPageMetadata(pageId);
    if (metadata !== null) {
      this.metadata.loadPage(pageIndex, metadata);
      this.metadataPageIds.add(pageId);
    }
  }

  private async saveCurrentPage(pageId: string) {
    if (this.sessionStore) {
      await this.sessionStore.saveCurrentPage(pageId, Date.now());
    }
  }

  private insertEmptyThumbnails(insertIndex: number, count: number) {
    this.thumbnails.splice(insertIndex, 0, ...Array<undefined>(count).fill(undefined));
    this.thumbnails = this.thumbnails.map((page, index) => page ? {
      ...page,
      pageIndex: index,
      pageNumber: index + 1,
      pageCount: this.sessionPages.length,
    } : page);
  }

  private async removeImportedPages(records: ViewerPageRecord[]) {
    const pageIds = records
      .filter((record) => !this.storedPageIds.has(record.pageId))
      .map((record) => record.pageId);
    if (!this.sessionStore || !pageIds.length) {
      return;
    }
    this.sessionPages = await this.sessionStore.removePages(pageIds, Date.now());
    const thumbnails = new Map(this.thumbnails.filter((page): page is ThumbnailPage => Boolean(page)).map((page) => [page.pageId, page]));
    this.thumbnails = this.sessionPages.map((record, index) => {
      const page = thumbnails.get(record.pageId);
      return page ? {
        ...page,
        pageIndex: index,
        pageNumber: index + 1,
        pageCount: this.sessionPages.length,
      } : undefined;
    });
    this.storedPageIds = new Set(Array.from(this.storedPageIds).filter((pageId) => !pageIds.includes(pageId)));
    this.pageCount = this.sessionPages.length;
    await this.refreshCurrentPageOrder();
    if (this.viewMode === "thumbnails") {
      this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
    }
  }

  private async reorderPages(request: ThumbnailReorderRequest) {
    if (this.sessionPages.length) {
      this.sessionPages = this.reorderedPages(request.fromPageIndex, request.toPageIndex, Date.now());
      this.moveThumbnail(request.fromPageIndex, request.toPageIndex);
      await this.refreshCurrentPageOrder();
      if (this.sessionStore) {
        this.sessionPages = await this.sessionStore.reorderPages(request.fromPageIndex, request.toPageIndex, Date.now());
      }
      if (this.viewMode === "thumbnails" && this.page) {
        this.thumbnailViewer.refresh(this.pageIds(), this.thumbnails, this.page.pageIndex, this.thumbnailMetadata());
      }
    }
  }

  private reorderedPages(fromPageIndex: number, toPageIndex: number, updatedAt: number) {
    return reorderPageRecords(this.sessionPages, fromPageIndex, toPageIndex, updatedAt);
  }

  private async refreshCurrentPageOrder() {
    if (!this.page) {
      return;
    }
    const pageIndex = this.sessionPages.findIndex((page) => page.pageId === this.page?.pageId);
    if (pageIndex < 0) {
      return;
    }
    this.page = {
      ...this.page,
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount: this.sessionPages.length,
    };
    await this.loadStoredPageMetadata(this.page.pageId, pageIndex);
    this.pageViewer.show(this.page);
    await this.saveCurrentPage(this.page.pageId);
  }

  private moveThumbnail(fromPageIndex: number, toPageIndex: number) {
    const [thumbnail] = this.thumbnails.splice(fromPageIndex, 1);
    this.thumbnails.splice(toPageIndex, 0, thumbnail ? {
      ...thumbnail,
      pageIndex: toPageIndex,
      pageNumber: toPageIndex + 1,
    } : undefined);
    this.thumbnails = this.thumbnails.map((thumbnailPage, index) => thumbnailPage ? {
      ...thumbnailPage,
      pageIndex: index,
      pageNumber: index + 1,
    } : thumbnailPage);
  }

  private sourcePageIndex(pageIndex: number) {
    if (!this.sessionPages.length) {
      return pageIndex;
    }
    return this.sessionPages[pageIndex].sourcePageIndex;
  }

  private async loadStoredRaster(pageIndex: number): Promise<RasterPage | null> {
    const pageId = this.sessionPages[pageIndex]?.pageId;
    if (!pageId || !this.storedPageIds.has(pageId)) {
      return null;
    }
    const record = await this.sessionStore?.readPageBlobRecord(pageId) ?? null;
    const blob = this.memoryBlobs.get(pageId) ?? record?.blob ?? null;
    if (!blob) {
      return null;
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("AuroraLens: canvas 2D context is not available.");
    }
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      sourceName: this.file?.name ?? "",
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount: this.sessionPages.length,
      width: bitmap.width,
      height: bitmap.height,
      pixels: new Uint8ClampedArray(imageData.data),
      xResolution: record?.xResolution,
      yResolution: record?.yResolution,
    };
  }

  private pagePosition(pageId: string) {
    const pageIndex = this.sessionPages.findIndex((page) => page.pageId === pageId);
    if (pageIndex < 0) {
      throw new Error("Stored viewer session is invalid.");
    }
    return pageIndex;
  }

  private async deleteSession() {
    if (this.sessionStore) {
      await this.sessionStore.delete();
    }
  }

  private async failStoredDocumentPersistence(error: unknown) {
    await this.deleteSession().catch(() => undefined);
    this.clearView();
    this.fail(error);
  }

  private state(): ViewerState {
    const busy = this.status === "loadingPage" || this.status === "loadingThumbnails" || this.status === "copyingSelection";
    const hasPage = Boolean(this.page);
    const pageIndex = this.page?.pageIndex ?? -1;
    return {
      viewMode: this.viewMode,
      status: this.status,
      sourceName: this.page?.sourceName ?? null,
      pageIndex,
      pageCount: this.pageCount,
      pageWidth: this.page?.width ?? null,
      pageHeight: this.page?.height ?? null,
      zoom: this.pageViewer.getZoom(),
      coordinates: this.coordinates,
      displayCoordinates: this.displayCoordinates,
      selectionCounts: this.selection.counts(),
      drawMode: this.pageViewer.getDrawMode(),
      canZoomIn: hasPage && !busy && this.pageViewer.canZoomIn(),
      canZoomOut: hasPage && !busy && this.pageViewer.canZoomOut(),
      canFitWidth: hasPage && !busy,
      canFitHeight: hasPage && !busy,
      canFitPage: hasPage && !busy,
      canActualSize: hasPage && !busy,
      canGoFirst: hasPage && !busy && pageIndex > 0,
      canGoPrevious: hasPage && !busy && pageIndex > 0,
      canGoNext: hasPage && !busy && pageIndex >= 0 && pageIndex < this.pageCount - 1,
      canGoLast: hasPage && !busy && pageIndex >= 0 && pageIndex < this.pageCount - 1,
      canShowThumbnails: this.pageCount > 0 && !busy,
      canSearch: hasPage && !busy && this.metadata.hasPage(pageIndex),
      canDraw: hasPage && !busy,
      canClearSelection: hasPage && !busy,
      canCopy: hasPage && !busy && this.selection.hasTokens(),
    };
  }

  private async toPage(page: RasterPage, maxSize?: number, pageIndex = page.pageIndex, sourceBlob?: Blob): Promise<RenderedPage> {
    const size = this.targetSize(page, maxSize);
    const blob = sourceBlob && size.width === page.width && size.height === page.height ? sourceBlob : await this.toBlob(page, size.width, size.height);
    return {
      sourceName: page.sourceName,
      pageId: this.sessionPages[pageIndex].pageId,
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount: this.sessionPages.length || page.pageCount,
      width: size.width,
      height: size.height,
      blob,
      sourcePageIndex: page.pageIndex,
      url: URL.createObjectURL(blob),
    };
  }

  private pageIds() {
    return this.sessionPages.map((page) => page.pageId);
  }

  private createPageRecords(pageCount: number, updatedAt: number) {
    const pages: ViewerPageRecord[] = [];
    for (let index = 0; index < pageCount; index += 1) {
      pages.push(this.createPageRecord(index, index + 1, updatedAt));
    }
    return pages;
  }

  private createPageRecord(sourcePageIndex: number, sequenceNumber: number, updatedAt: number): ViewerPageRecord {
    return {
      pageId: crypto.randomUUID(),
      documentId: ACTIVE_VIEWER_SESSION_ID,
      sequenceNumber,
      sourcePageIndex,
      updatedAt,
    };
  }

  private validateImportPage(page: RasterPage, importIndex: number, config: PageSizeConfig): ImportedPage {
    const validation = validateRasterPageSize({
      width: page.width,
      height: page.height,
      xResolution: "xResolution" in page && typeof page.xResolution === "number" ? page.xResolution : 0,
      yResolution: "yResolution" in page && typeof page.yResolution === "number" ? page.yResolution : 0,
    }, config);
    if (!validation.valid) {
      throw new DecoderError(DECODER_ERROR_PAGE_SIZE, `${page.sourceName}: page ${importIndex + 1} rejected. ${validation.reason}`);
    }
    if (!page.sourceType) {
      throw new Error("AuroraLens: decoded page is missing source type.");
    }
    return {
      ...page,
      sourceType: page.sourceType,
      xResolution: validation.xResolution,
      yResolution: validation.yResolution,
      documentType: validation.documentType,
      physicalWidth: validation.physicalWidth,
      physicalHeight: validation.physicalHeight,
    };
  }

  private toThumbnailPage(page: ImportedPage, pageIndex: number, blob: Blob): ThumbnailPage {
    return {
      sourceName: page.sourceName,
      pageId: this.sessionPages[pageIndex].pageId,
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount: this.sessionPages.length,
      width: page.width,
      height: page.height,
      url: URL.createObjectURL(blob),
    };
  }

  private targetSize(page: RasterPage, maxSize?: number) {
    if (!maxSize) {
      return {
        width: page.width,
        height: page.height,
      };
    }
    const scale = Math.min(1, maxSize / Math.max(page.width, page.height));
    return {
      width: Math.max(1, Math.ceil(page.width * scale)),
      height: Math.max(1, Math.ceil(page.height * scale)),
    };
  }

  private toBlob(page: RasterPage, width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("AuroraLens: canvas 2D context is not available.");
    }
    context.putImageData(new ImageData(page.pixels, page.width, page.height), 0, 0);
    const output = width === page.width && height === page.height ? canvas : document.createElement("canvas");
    if (output !== canvas) {
      output.width = width;
      output.height = height;
      const outputContext = output.getContext("2d");
      if (!outputContext) {
        throw new Error("AuroraLens: canvas 2D context is not available.");
      }
      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = "high";
      outputContext.drawImage(canvas, 0, 0, width, height);
    }
    return new Promise<Blob>((resolve, reject) => {
      output.toBlob((blob) => {
        if (!blob) {
          reject(new Error("AuroraLens: canvas did not produce a PNG blob."));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }
}
