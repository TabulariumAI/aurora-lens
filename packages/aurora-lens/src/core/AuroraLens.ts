import { assertContainer, assertDecoder, assertFile, assertPageIndex } from "./inputs";
import { MetadataRepository } from "./MetadataRepository";
import { MetadataHelper } from "./MetadataHelper";
import { PageViewer } from "./PageViewer";
import { ACTIVE_VIEWER_SESSION_ID, reorderPageRecords } from "./viewerSessionStore";
import { normalizeSelectionTheme } from "./selectionTheme";
import { SelectionManager } from "./SelectionManager";
import { ThumbnailViewer } from "./ThumbnailViewer";
import { DEFAULT_PAGE_FORMATS, DEFAULT_PAGE_TOLERANCE, validateRasterPageSize, type PageSizeConfig } from "./pageSizeValidation";
import type {
  ViewerDecoder,
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
  xResolution: number;
  yResolution: number;
}

export class AuroraLens {
  private readonly metadata = new MetadataHelper();
  private readonly metadataRepository = new MetadataRepository();
  private readonly selection: SelectionManager;
  private readonly decoder: ViewerDecoder;
  private readonly sessionStore: ViewerSessionStore | null;
  private readonly pageViewer: PageViewer;
  private readonly thumbnailViewer: ThumbnailViewer;
  private file: File | null = null;
  private page: RenderedPage | null = null;
  private metadataInput: unknown | null = null;
  private metadataPending = false;
  private sessionPages: ViewerPageRecord[] = [];
  private metadataPageIds = new Set<string>();
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
    assertDecoder(options.decoder);
    this.decoder = options.decoder;
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

  async decodeTiff(file: File, pageIndex: number): Promise<void> {
    assertFile(file);
    assertPageIndex(pageIndex);
    const newFile = this.file !== file;
    if (newFile) {
      this.persistenceRun += 1;
      this.revokePage();
      this.revokeThumbnails();
      this.file = file;
      this.pageCount = 0;
      this.sessionPages = [];
      this.metadataPageIds = new Set();
      this.storedPageIds = new Set();
      this.selection.clear();
      if (!this.metadataPending) {
        this.metadataInput = null;
        this.metadata.clear();
      }
    }
    const page = await this.loadPage(pageIndex, {
      loadMetadata: !newFile,
      saveCurrentPage: !newFile,
      setReady: !newFile,
    });
    if (newFile && page) {
      if (this.sessionStore) {
        const persistenceRun = this.persistenceRun;
        await this.resetStoredDocument(file, page);
        await this.loadStoredPageMetadata(page.pageId, page.pageIndex);
        await this.saveCurrentPage(page.pageId);
        void this.saveRemainingPageData(file, page.pageIndex, persistenceRun).catch((error: unknown) => {
          if (persistenceRun === this.persistenceRun) {
            this.failStoredDocumentPersistence(error);
          }
        });
      }
      this.pageViewer.render();
      this.metadataPending = false;
      this.setStatus("ready");
    }
  }

  async addPages(files: File[] | FileList, insertIndex: number): Promise<void> {
    const inputFiles = Array.from(files);
    inputFiles.forEach(assertFile);
    if (!this.file || !this.page || !this.sessionPages.length) {
      throw new Error("AuroraLens.addPages: open a TIFF before adding pages.");
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
    try {
      const config = await this.readPageValidationConfig();
      let records: ViewerPageRecord[] = [];
      await this.decoder.importPages(inputFiles, {
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
          await this.savePageBlob(pageIndex, blob, updatedAt);
          this.storedPageIds.add(record.pageId);
          this.thumbnails[pageIndex] = this.toThumbnailPage(importedPage, pageIndex, blob);
          if (this.viewMode === "thumbnails") {
            this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
          }
        },
      });
      this.setStatus("ready");
    } catch (error) {
      this.fail(error);
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

  async readPageValidationConfig(): Promise<PageSizeConfig> {
    if (!this.sessionStore) {
      return {
        formats: DEFAULT_PAGE_FORMATS.map((format) => ({ ...format })),
        tolerance: DEFAULT_PAGE_TOLERANCE,
      };
    }
    return this.sessionStore.readPageValidationConfig();
  }

  async savePageValidationConfig(config: PageSizeConfig): Promise<PageSizeConfig> {
    if (!this.sessionStore) {
      return {
        formats: config.formats.map((format) => ({ ...format })),
        tolerance: config.tolerance,
      };
    }
    return this.sessionStore.savePageValidationConfig(config);
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
    try {
      const storedPage = await this.loadStoredRaster(pageIndex);
      const sourcePageIndex = this.sourcePageIndex(pageIndex);
      const raster = storedPage ?? await this.decoder.decode(this.file, sourcePageIndex);
      if (!this.sessionPages.length) {
        this.sessionPages = this.createPageRecords(raster.pageCount, Date.now());
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
    } catch (error) {
      this.fail(error);
      throw error;
    }
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
      const sourcePageIndex = this.sourcePageIndex(pageIndex);
      this.thumbnailJobs.add(pageIndex);
      const pagePromise = this.storedPageIds.has(this.sessionPages[pageIndex]?.pageId ?? "")
        ? this.loadStoredRaster(pageIndex).then((page) => page ?? this.decoder.thumbnail(file, sourcePageIndex, size))
        : this.decoder.thumbnail(file, sourcePageIndex, size);
      pagePromise.then((page) => this.toPage(page, size, pageIndex)).then((thumbnail) => {
        this.thumbnailJobs.delete(pageIndex);
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

  private async resetStoredDocument(file: File, currentPage: RenderedPage) {
    if (!this.sessionStore) {
      return;
    }

    try {
      const updatedAt = Date.now();
      this.sessionPages = this.sessionPages.map((page) => ({
        ...page,
        updatedAt,
      }));
      this.sessionPages = await this.sessionStore.resetDocument({
        fileName: file.name,
        fileType: file.type,
        fileBlob: file,
        pages: this.sessionPages,
        pageCount: currentPage.pageCount,
        currentPageIndex: currentPage.pageIndex,
        updatedAt,
      });
      await this.savePageBlob(currentPage.pageIndex, currentPage.blob, updatedAt);
      await this.savePageMetadata(currentPage.pageId, updatedAt);
    } catch {
      await this.deleteSession().catch(() => undefined);
      throw new Error("Could not store the viewer session.");
    }
  }

  private async saveRemainingPageData(file: File, currentPageIndex: number, persistenceRun: number) {
    for (const page of this.sessionPages) {
      if (persistenceRun !== this.persistenceRun) {
        return;
      }
      if (page.sequenceNumber - 1 !== currentPageIndex) {
        const updatedAt = Date.now();
        const raster = await this.decoder.decode(file, page.sourcePageIndex);
        const blob = await this.toBlob(raster, raster.width, raster.height);
        await this.savePageBlob(page.sequenceNumber - 1, blob, updatedAt);
        await this.savePageMetadata(page.pageId, updatedAt);
      }
    }
  }

  private async savePageBlob(pageIndex: number, blob: Blob, updatedAt: number) {
    const page = this.sessionPages[pageIndex];
    if (this.sessionStore && page) {
      await this.sessionStore.savePageBlob({
        pageId: page.pageId,
        blob,
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
    this.metadata.clear();
    if (!this.sessionStore) {
      return;
    }
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
    if (!this.sessionStore || !pageId || !this.storedPageIds.has(pageId)) {
      return null;
    }
    const blob = await this.sessionStore.readPageBlob(pageId);
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

  private async toPage(page: RasterPage, maxSize?: number, pageIndex = page.pageIndex): Promise<RenderedPage> {
    const size = this.targetSize(page, maxSize);
    const blob = await this.toBlob(page, size.width, size.height);
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
      xResolution: 0,
      yResolution: 0,
    }, config);
    if (!validation.valid) {
      throw new Error(`${page.sourceName}: page ${importIndex + 1} rejected. ${validation.reason}`);
    }
    return {
      ...page,
      xResolution: validation.xResolution,
      yResolution: validation.yResolution,
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
