import { readRasterImage } from "./decoder/rasterImage";
import { assertContainer, assertDecodeOptions, assertFile, assertViewMode } from "./input/inputs";
import { MetadataRepository } from "./metadata/MetadataRepository";
import { MetadataHelper } from "./metadata/MetadataHelper";
import { PageViewer } from "./viewer/PageViewer";
import { ACTIVE_VIEWER_SESSION_ID, reorderPageRecords } from "./session/viewerSessionStore";
import { LENS_ERROR_PAGE_OUT_OF_RANGE, LENS_ERROR_PAGE_SIZE, LensError } from "./errors/LensError";
import { DocumentDecoder } from "./decoder/DocumentDecoder";
import { normalizeSelectionTheme } from "./selection/selectionTheme";
import { SelectionManager } from "./selection/SelectionManager";
import { ThumbnailViewer, type ThumbnailReorderRequest } from "./viewer/ThumbnailViewer";
import { TiffExporter } from "./export/TiffExporter";
import type { ExportProgress } from "./export/types";
import { validateRasterPageSize } from "./validation/pageSizeValidation";
import { defaultViewerConfig, type ViewerConfig } from "./config/viewerConfig";
import { DOC_TYPE_TIFF, type DecodedPage as DecodedDocPage, type DocType } from "./decoder/types";
import { detectDocType } from "./decoder/detect";
import type {
  ViewerOptions,
  ViewerState,
  ViewerStatus,
  ViewMode,
  DecodeDocOptions,
  CopySelectionResult,
  ThumbnailPage,
  MetadataIndex,
  PageMetadataHits,
  PagePoint,
  PageInfo,
  RasterPage,
  SelectedGroup,
  ViewerPageBlobRecord,
  ViewerPageRecord,
  ViewerSessionStore,
} from "./types";

const RESTORE_ERROR_MESSAGE = "Could not restore the previous viewer session.";
const TIFF_FILE_TYPE = "image/tiff";
const PAGE_CACHE_LIMIT = 3;
const PAGE_CACHE_BYTES = 64 * 1024 * 1024;
const PREFETCH_RADIUS = 1;

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
  private readonly theme: ReturnType<typeof normalizeSelectionTheme>;
  private readonly selection: SelectionManager;
  private readonly decoder = new DocumentDecoder();
  private readonly exporter = new TiffExporter();
  private readonly sessionStore: ViewerSessionStore | null;
  private readonly pageViewer: PageViewer;
  private readonly thumbnailViewer: ThumbnailViewer;
  private file: File | null = null;
  private page: ThumbnailPage | null = null;
  private pageMap = new Map<string, string>();
  private metadataInput: unknown | null = null;
  private metadataPending = false;
  private sessionPages: ViewerPageRecord[] = [];
  private metadataPageIds = new Set<string>();
  private memoryBlobs = new Map<string, Blob>();
  private thumbnails: Array<ThumbnailPage | undefined> = [];
  private thumbnailJobs = new Set<number>();
  private thumbnailKeep = new Set<number>();
  private storedPageIds = new Set<string>();
  private baselinePageIds: string[] = [];
  private thumbnailRun = 0;
  private viewMode: ViewMode = "page";
  private status: ViewerStatus = "idle";
  private coordinates: PagePoint | null = null;
  private displayCoordinates: PagePoint | null = null;
  private pageCount = 0;
  private runId = 0;
  private documentRun = 0;
  private sourceType: DocType | null = null;
  private requestedPageId: string | null = null;
  private sourcePages = new Set<string>();
  private sourceNames = new Map<string, string>();
  private pageJobs = new Map<string, Promise<Blob | null>>();
  private pageQueue: Promise<unknown> = Promise.resolve();
  private sessionDeletion: Promise<void> = Promise.resolve();
  private thumbnailQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly container: HTMLElement, private readonly options: ViewerOptions) {
    assertContainer(container);
    this.sessionStore = options.sessionStore ?? null;
    this.theme = normalizeSelectionTheme(options.selectionTheme);
    this.selection = new SelectionManager(this.theme);
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
      intelligenceColor: this.theme.intelligence,
      onAdd: (files, insertIndex) => this.addPages(files, insertIndex),
      onRange: (pageIndexes) => {
        this.loadThumbnails(pageIndexes);
      },
      onReorder: (request) => this.reorderPages(request),
      onRemove: (pageId) => this.removePage(pageId),
      onError: (error) => this.fail(error),
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
    this.pageViewer.close();
  }

  clear(): void {
    this.clearView();
    const runId = this.runId;
    this.sessionDeletion = this.sessionDeletion.catch(() => undefined).then(() => this.deleteSession());
    void this.sessionDeletion.catch(error => {
      if (runId === this.runId) this.fail(error);
    });
  }

  private clearView(): void {
    this.decoder.close();
    this.documentRun += 1;
    this.sourceType = null;
    this.requestedPageId = null;
    this.sourcePages.clear();
    this.sourceNames.clear();
    this.pageJobs.clear();
    this.pageQueue = Promise.resolve();
    this.exporter.close();
    this.runId += 1;
    this.revokePage();
    this.revokeThumbnails();
    this.file = null;
    this.baselinePageIds = [];
    this.pageCount = 0;
    this.viewMode = "page";
    this.status = "idle";
    this.coordinates = null;
    this.displayCoordinates = null;
    this.metadataInput = null;
    this.pageMap.clear();
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
      this.pageMap = this.metadataRepository.pageMap(pageMetadata, this.sessionPages);
      void this.saveMetadataPages(pageMetadata).then(() => this.loadCurrentPageMetadata()).catch((error: unknown) => this.fail(error));
    }
    this.emitState();
  }

  async restoreSession(): Promise<boolean> {
    if (!this.sessionStore) {
      return false;
    }

    let restoreRun = this.runId;
    try {
      await this.sessionDeletion;
      const session = await this.sessionStore.read();
      if (restoreRun !== this.runId) {
        return false;
      }
      if (!session) {
        return false;
      }

      if (session.document.sessionId !== this.options.sessionId) {
        await this.deleteSession();
        return false;
      }

      this.clearView();
      restoreRun = this.runId;
      this.sessionPages = session.pages;
      this.pageMap = this.metadataRepository.pageMap(null, this.sessionPages);
      const pages: unknown[] = [];
      const pageMap: Record<string, number> = Object.create(null);
      for (const page of this.sessionPages) {
        const metadata = await this.sessionStore.readPageMetadata(page.pageId) as { pageNames?: string[] } | null;
        if (restoreRun !== this.runId) return false;
        if (metadata !== null) pages[page.sourcePageIndex] = metadata;
        for (const name of metadata?.pageNames ?? []) {
          this.pageMap.set(name, page.pageId);
          pageMap[name] = page.sourcePageIndex;
        }
      }
      if (pages.length) this.metadataInput = { pages, pageMap };
      const metadataPageIds = await this.sessionStore.readPageMetadataIds();
      if (restoreRun !== this.runId) return false;
      this.metadataPageIds = metadataPageIds;
      this.storedPageIds = new Set(session.pages.map((page) => page.pageId));
      this.baselinePageIds = this.pageIds();
      this.file = new File([session.document.fileBlob], session.document.fileName, { type: session.document.fileType || TIFF_FILE_TYPE });
      this.sourceType = detectDocType(new Uint8Array(await this.file.slice(0, 8).arrayBuffer()), this.file);
      if (restoreRun !== this.runId) return false;
      this.sourcePages = new Set(this.sessionPages.map(page => page.pageId));
      const loading = this.loadPage(this.pagePosition(session.currentPage.pageId), {
        loadMetadata: true,
        saveCurrentPage: true,
        setReady: true,
      });
      restoreRun = this.runId;
      return await loading !== null;
    } catch {
      if (restoreRun !== this.runId) return false;
      this.clearView();
      await this.deleteSession().catch(() => undefined);
      this.options.onError?.(new Error(RESTORE_ERROR_MESSAGE));
      return false;
    }
  }

  async decodeDoc(file: File, options: DecodeDocOptions): Promise<void> {
    assertFile(file);
    assertDecodeOptions(options);
    assertViewMode(options.viewMode);
    let pageIndex: number;
    const openRun = this.runId + 1;
    const documentRun = ++this.documentRun;
    this.decoder.close();
    this.pageJobs.clear();
    this.pageQueue = Promise.resolve();
    this.sourcePages.clear();
    this.sourceNames.clear();
    this.sourceType = null;
    this.requestedPageId = null;
    this.exporter.close();
    this.runId = openRun;
    try {
      await this.sessionDeletion;
      if (documentRun !== this.documentRun) throw new DOMException("Document decoder closed.", "AbortError");
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
      if (documentRun !== this.documentRun) throw new DOMException("Document decoder closed.", "AbortError");
      let firstReady = false;
      let resolveFirst: () => void = () => undefined;
      let rejectFirst: (error: unknown) => void = () => undefined;
      const firstPage = new Promise<void>((resolve, reject) => {
        resolveFirst = resolve;
        rejectFirst = reject;
      });

      const done = this.decoder.decodeDoc(file, {
        pageCount: async (count, sourceType) => {
          if (documentRun !== this.documentRun) return;
          this.sourceType = sourceType ?? null;
          const updatedAt = Date.now();
          this.sessionPages = this.createPageRecords(count, updatedAt);
          this.pageCount = count;
          this.pageMap = this.metadataRepository.pageMap(this.metadataInput, this.sessionPages);
          pageIndex = this.resolvePage(options.page);
          this.requestedPageId = this.sessionPages[pageIndex].pageId;
          if (this.sessionStore) {
            const pages = await this.sessionStore.resetDocument({
              sessionId: this.options.sessionId,
              fileName: file.name,
              fileType: file.type,
              fileBlob: file,
              pages: this.sessionPages,
              pageCount: count,
              currentPageIndex: pageIndex,
              updatedAt,
            });
            if (documentRun !== this.documentRun) throw new DOMException("Document decoder closed.", "AbortError");
            this.sessionPages = pages;
          }
          this.baselinePageIds = this.pageIds();
          this.sourcePages = new Set(this.baselinePageIds);
          if (this.metadataInput !== null) await this.saveMetadataPages(this.metadataInput);
        },
        pageReady: async (page) => {
          if (documentRun !== this.documentRun) {
            return;
          }
          const record = this.sessionPages[page.pageIndex];
          if (!record) {
            return;
          }
          const importedPage = this.validateImportPage(page, page.pageIndex);
          const blob = await this.storePage(importedPage, record.pageId, documentRun);
          if (!blob) return;
          const currentIndex = this.pagePosition(record.pageId);
          if (page.pageIndex === pageIndex && !firstReady) {
            const rendered = await this.toPage(importedPage, undefined, currentIndex, blob);
            if (openRun !== this.runId) {
              URL.revokeObjectURL(rendered.url);
              return;
            }
            this.revokePage();
            this.page = rendered;
            this.coordinates = null;
            this.displayCoordinates = null;
            this.selection.clear();
            await this.loadStoredPageMetadata(rendered.pageId, rendered.pageIndex);
            this.viewMode = options.viewMode;
            if (options.viewMode === "page") {
              this.showView("page");
              this.pageViewer.show(rendered);
            } else {
              this.thumbnailRun += 1;
              this.thumbnailKeep = new Set();
              this.thumbnailViewer.show(this.pageIds(), this.pageCount, rendered.sourceName, rendered, this.thumbnails, rendered.pageIndex, this.thumbnailMetadata());
              this.showView("thumbnails");
            }
            await this.saveCurrentPage(rendered.pageId);
            this.metadataPending = false;
            firstReady = true;
            this.setStatus("ready");
            resolveFirst();
            void this.prefetch(openRun, currentIndex);
          }
        },
      }, config.view, () => pageIndex).catch((error: unknown) => {
        if (!firstReady) {
          rejectFirst(error);
          return;
        }
        if (documentRun === this.documentRun) {
          void this.failStoredDocumentPersistence(error, documentRun);
        }
      });

      await firstPage;
      void done;
    } catch (error) {
      if (documentRun === this.documentRun) {
        await this.deleteSession().catch(() => undefined);
        this.clearView();
      }
      throw error;
    }
  }

  isDirty(): boolean {
    const currentPageIds = this.pageIds();

    if (!this.baselinePageIds.length || !currentPageIds.length) {
      return false;
    }

    if (currentPageIds.length !== this.baselinePageIds.length) {
      return true;
    }

    return currentPageIds.some((pageId, index) => pageId !== this.baselinePageIds[index]);
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

    const documentRun = this.documentRun;
    this.setStatus("addingPages");
    let records: ViewerPageRecord[] = [];
    try {
      const config = await this.readViewerConfig();
      await this.decoder.decodeDocs(inputFiles, {
        pageCount: async (count) => {
          if (documentRun !== this.documentRun) throw new DOMException("Document decoder closed.", "AbortError");
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
          if (documentRun !== this.documentRun) return;
          const record = records[importIndex];
          if (!record) {
            throw new Error("AuroraLens.addPages: decoder emitted a page before the page count.");
          }
          const importedPage = this.validateImportPage(page, importIndex);
          await this.storePage(importedPage, record.pageId, documentRun);
        },
      }, config.view);
      if (documentRun === this.documentRun) this.setStatus("ready");
    } catch (error) {
      if (documentRun === this.documentRun) {
        await this.removeImportedPages(records);
        this.setStatus("ready");
        this.options.onAddError?.(error instanceof Error ? error : new Error(String(error)));
      }
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
        view: { ...config.view },
        export: {
          ...config.export,
          tiff: { ...config.export.tiff },
        },
      };
    }
    return this.sessionStore.saveViewerConfig(config);
  }

  async exportTiff(onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
    if (!this.sessionStore || !this.sessionPages.length) {
      throw new Error("AuroraLens.exportTiff: open a document before exporting.");
    }
    const exportRun = this.runId;
    const sessionPages = this.sessionPages;
    const config = await this.readViewerConfig();
    const pages: ViewerPageBlobRecord[] = [];
    for (const page of sessionPages) {
      await this.ensurePage(page.pageId, exportRun);
      const record = await this.sessionStore.readPageBlobRecord(page.pageId);
      if (exportRun !== this.runId) {
        throw new DOMException("TIFF export closed.", "AbortError");
      }
      if (!record) {
        throw new Error("AuroraLens.exportTiff: document pages are not ready.");
      }
      pages.push(record);
    }
    return this.exporter.export(pages, config.export, onProgress);
  }

  readPageInfo(): PageInfo | null {
    if (!this.page || !this.metadata.hasPage(this.page.pageIndex)) {
      return null;
    }
    return this.metadata.pageInfo(this.page.pageIndex);
  }

  readPageName(): string | null {
    if (!this.page) return null;
    const names = [...this.pageMap].filter(([, pageId]) => pageId === this.page?.pageId).map(([name]) => name);
    return names.find((name) => !/^\d+$/.test(name)) ?? names[0] ?? null;
  }

  exportSelection(): SelectedGroup[] {
    if (!this.page || !this.selection.hasTokens()) return [];
    return this.metadata.exportGroups(this.page.pageIndex, this.selection.tokens());
  }

  async copySelection(): Promise<CopySelectionResult> {
    const runId = this.runId;
    const groups = this.exportSelection();
    if (!groups.length) {
      return {
        copied: false,
        groups: [],
        text: "",
      };
    }
    this.setStatus("copyingSelection");
    try {
      const text = [...new Set(groups.flatMap((group) => group.value.token.filter((token): token is string => typeof token === "string")))].join(" ");
      await navigator.clipboard.writeText(text);
      if (runId === this.runId) this.setStatus("ready");
      return {
        copied: true,
        groups,
        text,
      };
    } catch (error) {
      if (runId === this.runId) this.fail(error);
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

  search(text: string, options?: { additive?: boolean; context?: string | null }): PageMetadataHits | null {
    if (!this.page || !this.metadata.hasPage(this.page.pageIndex)) {
      return null;
    }
    const hits = this.metadata.search(this.page.pageIndex, text, options?.context);
    this.showHits(hits, options?.additive);
    return hits;
  }

  highlightIndex(pageNumber: string | number, index: MetadataIndex, options?: { additive?: boolean }): boolean {
    if (!this.page || this.page.pageIndex !== this.resolvePage(pageNumber) || !this.metadata.hasPage(this.page.pageIndex)) {
      return false;
    }
    const hits = this.metadata.highlightIndex(this.page.pageIndex, index);
    this.showHits(hits, options?.additive);
    return hits.tokens.length > 0 || hits.contexts.length > 0;
  }

  private showHits(hits: PageMetadataHits, additive?: boolean) {
    if (additive) {
      this.selection.showElements(hits);
    } else {
      this.selection.showElement(hits);
    }
    this.pageViewer.render();
    this.emitState();
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

  firstPage(): Promise<void> {
    return this.goPage(0);
  }

  lastPage(): Promise<void> {
    return this.goPage(this.pageCount - 1);
  }

  nextPage(): Promise<void> {
    return this.goPage(this.state().pageIndex + 1);
  }

  previousPage(): Promise<void> {
    return this.goPage(this.state().pageIndex - 1);
  }

  resolvePage(name: string | number): number {
    const pageMap = new Map(this.sessionPages.map((page, index) => [String(index + 1), page.pageId]));
    for (const [name, pageId] of this.pageMap) pageMap.set(name, pageId);
    const pageId = pageMap.get(String(name));
    const index = this.sessionPages.findIndex(page => page.pageId === pageId);
    if (index < 0) throw new LensError(LENS_ERROR_PAGE_OUT_OF_RANGE, `Page ${name} is outside the available page range.`);
    return index;
  }

  async goToPage(name: string | number): Promise<void> {
    let pageIndex: number;
    try {
      pageIndex = this.resolvePage(name);
    } catch (error) {
      this.fail(error);
      throw error;
    }
    await this.goPage(pageIndex);
  }

  async showThumbnails(): Promise<void> {
    if (!this.file || !this.page || !this.pageCount) {
      return;
    }
    try {
      this.thumbnailRun += 1;
      this.thumbnailJobs.clear();
      this.thumbnailKeep = new Set();
      this.viewMode = "thumbnails";
      this.thumbnailViewer.show(this.pageIds(), this.pageCount, this.page.sourceName, this.page, this.thumbnails, this.page.pageIndex, this.thumbnailMetadata());
      this.showView("thumbnails");
      this.setStatus("ready");
    } catch (error) {
      this.fail(error);
      throw error;
    }
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
    const documentRun = this.documentRun;
    try {
      await this.loadPage(pageIndex, {
        loadMetadata: true,
        saveCurrentPage: true,
        setReady: true,
      });
    } catch (error) {
      await this.failStoredDocumentPersistence(error, documentRun);
      throw error;
    }
  }

  private async loadPage(pageIndex: number, options: { loadMetadata: boolean; saveCurrentPage: boolean; setReady: boolean }): Promise<ThumbnailPage | null> {
    if (!this.file) {
      return null;
    }
    const runId = this.runId + 1;
    this.runId = runId;
    this.requestedPageId = this.sessionPages[pageIndex]?.pageId ?? null;
    this.setStatus("loadingPage");
    const raster = await this.loadStoredRaster(pageIndex, runId);
    if (!raster || runId !== this.runId) {
      return null;
    }
    const page = await this.toPage(raster, undefined, pageIndex, raster.blob);
    if (runId !== this.runId) {
      URL.revokeObjectURL(page.url);
      return null;
    }
    if (options.loadMetadata) {
      await this.loadStoredPageMetadata(page.pageId, page.pageIndex);
    }
    if (runId !== this.runId) {
      URL.revokeObjectURL(page.url);
      return null;
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
    void this.prefetch(runId, pageIndex);
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
      const pageId = this.sessionPages[pageIndex]?.pageId;
      if (!this.sourcePages.has(pageId) && !this.storedPageIds.has(pageId)) return;
      if (this.thumbnails[pageIndex] || this.thumbnailJobs.has(pageIndex)) {
        return;
      }
      this.thumbnailJobs.add(pageIndex);
      this.thumbnailQueue = this.thumbnailQueue.catch(() => undefined).then(async () => {
        if (run !== this.thumbnailRun || this.viewMode !== "thumbnails" || !this.thumbnailKeep.has(pageIndex) || this.sessionPages[pageIndex]?.pageId !== pageId) return null;
        const page = await this.loadStoredRaster(pageIndex, this.runId);
        if (run !== this.thumbnailRun || this.sessionPages[pageIndex]?.pageId !== pageId) return null;
        return page ? this.toPage(page, size, pageIndex) : null;
      }).then((thumbnail) => {
        if (run === this.thumbnailRun) this.thumbnailJobs.delete(pageIndex);
        if (!thumbnail) {
          return;
        }
        if (run !== this.thumbnailRun || this.viewMode !== "thumbnails" || !this.thumbnailKeep.has(pageIndex) || this.sessionPages[pageIndex]?.pageId !== pageId) {
          URL.revokeObjectURL(thumbnail.url);
          return;
        }
        this.thumbnails[pageIndex] = thumbnail;
        this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
        this.revokeSkipped(this.thumbnailKeep);
      }).catch((error: unknown) => {
        if (run === this.thumbnailRun) this.thumbnailJobs.delete(pageIndex);
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
    if (record) this.sourceNames.set(record.pageId, raster.sourceName);
    if (record && !this.sessionStore) {
      this.memoryBlobs.set(record.pageId, blob);
      if (this.sourceType === DOC_TYPE_TIFF) {
        let bytes = [...this.memoryBlobs.values()].reduce((sum, value) => sum + value.size, 0);
        for (const [pageId, value] of this.memoryBlobs) {
          if (this.memoryBlobs.size <= PAGE_CACHE_LIMIT && bytes <= PAGE_CACHE_BYTES) break;
          this.memoryBlobs.delete(pageId);
          bytes -= value.size;
        }
      }
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
    const documentRun = this.documentRun;
    const pages = this.metadataRepository.split(pageMetadata, this.sessionPages);
    for (const page of pages) {
      if (documentRun !== this.documentRun) return;
      await this.sessionStore.savePageMetadata({
        pageId: page.pageId,
        metadata: page.metadata,
        updatedAt,
      });
      if (documentRun !== this.documentRun) return;
      this.metadataPageIds.add(page.pageId);
    }
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
    const runId = this.runId;
    const metadata = await this.sessionStore.readPageMetadata(pageId);
    if (runId !== this.runId) return;
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
      const documentRun = this.documentRun;
      const updatedAt = Date.now();
      const pages = this.sessionStore
        ? await this.sessionStore.reorderPages(request.fromPageIndex, request.toPageIndex, updatedAt)
        : reorderPageRecords(this.sessionPages, request.fromPageIndex, request.toPageIndex, updatedAt);
      if (documentRun !== this.documentRun) return;
      this.sessionPages = pages;
      this.moveThumbnail(request.fromPageIndex, request.toPageIndex);
      await this.refreshCurrentPageOrder();
      if (this.viewMode === "thumbnails" && this.page) {
        this.thumbnailViewer.refresh(this.pageIds(), this.thumbnails, this.page.pageIndex, this.thumbnailMetadata());
      }
    }
  }

  private async removePage(pageId: string) {
    if (!this.sessionStore || this.sessionPages.length < 2) {
      throw new Error("AuroraLens.removePage: package-owned storage and at least two pages are required.");
    }
    const pageIndex = this.sessionPages.findIndex((page) => page.pageId === pageId);
    if (pageIndex < 0) {
      throw new Error("AuroraLens.removePage: pageId must match an open document page.");
    }
    this.setStatus("loadingPage");
    const currentRemoved = this.page?.pageId === pageId;
    const nextIndex = Math.min(pageIndex, this.sessionPages.length - 2);
    const nextPageId = currentRemoved ? this.sessionPages[nextIndex === pageIndex ? pageIndex + 1 : nextIndex].pageId : null;
    if (nextPageId) {
      await this.saveCurrentPage(nextPageId);
    }
    const updatedAt = Date.now();
    this.sessionPages = await this.sessionStore.removePages([pageId], updatedAt);
    this.removeThumbnail(pageId);
    this.memoryBlobs.delete(pageId);
    this.sourceNames.delete(pageId);
    this.storedPageIds.delete(pageId);
    this.metadataPageIds.delete(pageId);
    this.pageCount = this.sessionPages.length;
    if (currentRemoved) {
      await this.loadCurrentAfterRemove(nextIndex);
    } else {
      await this.refreshCurrentPageOrder();
    }
    if (this.viewMode === "thumbnails") {
      this.thumbnailViewer.update(this.pageIds(), this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
    }
    this.setStatus("ready");
  }

  private removeThumbnail(pageId: string) {
    const thumbnails = new Map(this.thumbnails.filter((page): page is ThumbnailPage => Boolean(page)).map((page) => [page.pageId, page]));
    const removed = thumbnails.get(pageId);
    if (removed) {
      URL.revokeObjectURL(removed.url);
    }
    thumbnails.delete(pageId);
    this.thumbnails = this.sessionPages.map((record, index) => {
      const page = thumbnails.get(record.pageId);
      return page ? {
        ...page,
        pageIndex: index,
        pageNumber: index + 1,
        pageCount: this.sessionPages.length,
      } : undefined;
    });
  }

  private async loadCurrentAfterRemove(pageIndex: number) {
    const raster = await this.loadStoredRaster(pageIndex, this.runId);
    if (!raster) {
      return;
    }
    const page = await this.toPage(raster, undefined, pageIndex, raster.blob);
    this.revokePage();
    this.page = page;
    this.coordinates = null;
    this.displayCoordinates = null;
    this.selection.clear();
    await this.loadStoredPageMetadata(page.pageId, page.pageIndex);
    if (this.viewMode === "page") {
      this.showView("page");
      this.pageViewer.show(page);
    }
    await this.saveCurrentPage(page.pageId);
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

  private async storePage(page: ImportedPage, pageId: string, documentRun: number): Promise<Blob | null> {
    const blob = await this.toBlob(page, page.width, page.height);
    if (documentRun !== this.documentRun || !this.sessionPages.some(record => record.pageId === pageId)) return null;
    await this.savePageBlob(this.pagePosition(pageId), blob, Date.now(), page);
    if (documentRun !== this.documentRun) return null;
    this.storedPageIds.add(pageId);
    if (this.viewMode === "thumbnails") this.loadThumbnails([...this.thumbnailKeep]);
    return blob;
  }

  private ensurePage(pageId: string, runId: number): Promise<Blob | null> {
    const pending = this.pageJobs.get(pageId);
    if (pending) return pending;
    const documentRun = this.documentRun;
    const file = this.file;
    const job = this.pageQueue.catch(() => undefined).then(async () => {
      if (documentRun !== this.documentRun || !file) return null;
      if (runId !== this.runId && pageId !== this.requestedPageId) return null;
      const record = this.sessionPages.find(page => page.pageId === pageId);
      if (!record) return null;
      const cached = this.memoryBlobs.get(pageId);
      if (cached) {
        this.memoryBlobs.delete(pageId);
        this.memoryBlobs.set(pageId, cached);
        return cached;
      }
      const stored = await this.sessionStore?.readPageBlobRecord(pageId);
      if (documentRun !== this.documentRun) return null;
      if (stored) return stored.blob;
      if (this.sourceType !== DOC_TYPE_TIFF || !this.sourcePages.has(pageId)) return null;
      const config = await this.readViewerConfig();
      if (documentRun !== this.documentRun) return null;
      let blob: Blob | null = null;
      await this.decoder.decodePage(file, record.sourcePageIndex, {
        pageCount() {},
        pageReady: async page => {
          if (documentRun !== this.documentRun) return;
          blob = await this.storePage(this.validateImportPage(page, page.pageIndex), pageId, documentRun);
        },
      }, config.view);
      return blob;
    });
    this.pageQueue = job;
    this.pageJobs.set(pageId, job);
    void job.finally(() => {
      if (this.pageJobs.get(pageId) === job) this.pageJobs.delete(pageId);
    }).catch(() => undefined);
    return job;
  }

  private async prefetch(runId: number, pageIndex: number) {
    if (this.sourceType !== DOC_TYPE_TIFF) return;
    const documentRun = this.documentRun;
    try {
      for (let distance = 1; distance <= PREFETCH_RADIUS; distance++) {
        for (const index of [pageIndex + distance, pageIndex - distance]) {
          if (runId !== this.runId || this.viewMode !== "page") return;
          const record = this.sessionPages[index];
          if (record) await this.ensurePage(record.pageId, runId);
        }
      }
    } catch (error) {
      await this.failStoredDocumentPersistence(error, documentRun);
    }
  }

  private async loadStoredRaster(pageIndex: number, runId: number): Promise<(RasterPage & { blob: Blob }) | null> {
    const pageId = this.sessionPages[pageIndex]?.pageId;
    if (!pageId) return null;
    const blob = await this.ensurePage(pageId, runId);
    if (!blob) {
      return null;
    }
    const image = await readRasterImage(blob);
    return {
      sourceName: this.sourceNames.get(pageId) ?? this.file?.name ?? "",
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount: this.sessionPages.length,
      ...image,
      blob,
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

  private async failStoredDocumentPersistence(error: unknown, documentRun: number) {
    if (documentRun !== this.documentRun) return;
    await this.deleteSession().catch(() => undefined);
    if (documentRun !== this.documentRun) return;
    this.clearView();
    this.fail(error);
  }

  private state(): ViewerState {
    const busy = this.status === "addingPages" || this.status === "loadingPage" || this.status === "loadingThumbnails" || this.status === "copyingSelection";
    const hasPage = Boolean(this.page);
    const pageIndex = this.page?.pageIndex ?? -1;
    return {
      viewMode: this.viewMode,
      status: this.status,
      sourceName: this.page?.sourceName ?? null,
      pageIndex,
      pageCount: this.pageCount,
      metadataPageCount: this.metadataPageIds.size,
      pageInfo: hasPage && this.metadata.hasPage(pageIndex) ? this.metadata.pageInfo(pageIndex) : null,
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

  private async toPage(page: RasterPage, maxSize?: number, pageIndex = page.pageIndex, sourceBlob?: Blob): Promise<ThumbnailPage> {
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

  private validateImportPage(page: RasterPage, importIndex: number): ImportedPage {
    const validation = validateRasterPageSize({
      width: page.width,
      height: page.height,
      xResolution: "xResolution" in page && typeof page.xResolution === "number" ? page.xResolution : 0,
      yResolution: "yResolution" in page && typeof page.yResolution === "number" ? page.yResolution : 0,
    }, this.options.pageSize);
    if (!validation.valid) {
      throw new LensError(LENS_ERROR_PAGE_SIZE, `${page.sourceName}: page ${importIndex + 1} rejected. ${validation.reason}`, {
        sourceName: page.sourceName,
        pageNumber: importIndex + 1,
        width: page.width,
        height: page.height,
        tolerance: this.options.pageSize.tolerance,
        requiredTolerance: validation.requiredTolerance,
      });
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
        canvas.width = 0;
        canvas.height = 0;
        output.width = 0;
        output.height = 0;
        if (!blob) {
          reject(new Error("AuroraLens: canvas did not produce a PNG blob."));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }
}
