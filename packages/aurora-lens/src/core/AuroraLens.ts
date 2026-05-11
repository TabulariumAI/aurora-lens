import { assertContainer, assertDecoder, assertFile, assertPageIndex } from "./inputs";
import { MetadataHelper } from "./MetadataHelper";
import { PageViewer } from "./PageViewer";
import { normalizeSelectionTheme } from "./selectionTheme";
import { SelectionManager } from "./SelectionManager";
import { ThumbnailViewer } from "./ThumbnailViewer";
import type {
  AuroraLensDecoder,
  AuroraLensOptions,
  AuroraLensState,
  AuroraLensStatus,
  AuroraLensViewMode,
  CopySelectionResult,
  DecodedPage,
  PageMetadataHits,
  PagePoint,
  RasterPage,
  ThumbnailPage,
} from "./types";

export class AuroraLens {
  private readonly metadata = new MetadataHelper();
  private readonly selection: SelectionManager;
  private readonly decoder: AuroraLensDecoder;
  private readonly pageViewer: PageViewer;
  private readonly thumbnailViewer: ThumbnailViewer;
  private file: File | null = null;
  private page: DecodedPage | null = null;
  private thumbnails: Array<ThumbnailPage | undefined> = [];
  private thumbnailJobs = new Set<number>();
  private thumbnailKeep = new Set<number>();
  private thumbnailRun = 0;
  private viewMode: AuroraLensViewMode = "page";
  private status: AuroraLensStatus = "idle";
  private coordinates: PagePoint | null = null;
  private displayCoordinates: PagePoint | null = null;
  private pageCount = 0;
  private runId = 0;

  constructor(private readonly container: HTMLElement, private readonly options: AuroraLensOptions) {
    assertContainer(container);
    assertDecoder(options.decoder);
    this.decoder = options.decoder;
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
      onRange: (pageIndexes) => {
        this.loadThumbnails(pageIndexes);
      },
      onSelect: (pageIndex) => {
        this.options.onThumbnailSelect?.(pageIndex);
      },
    });
    this.mount();
    this.emitStatus();
    this.emitState();
  }

  close(): void {
    this.clear();
  }

  clear(): void {
    this.runId += 1;
    this.revokePage();
    this.revokeThumbnails();
    this.file = null;
    this.pageCount = 0;
    this.viewMode = "page";
    this.status = "idle";
    this.coordinates = null;
    this.displayCoordinates = null;
    this.metadata.clear();
    this.pageViewer.clear();
    this.thumbnailViewer.clear();
    this.showView("page");
    this.emitStatus();
    this.emitState();
  }

  loadMetadata(pageMetadata: unknown): void {
    this.metadata.load(pageMetadata);
    this.emitState();
  }

  async decodeTiff(file: File, pageIndex: number): Promise<void> {
    assertFile(file);
    assertPageIndex(pageIndex);
    if (this.file !== file) {
      this.revokePage();
      this.revokeThumbnails();
      this.file = file;
      this.pageCount = 0;
      this.selection.clear();
    }
    await this.loadPage(pageIndex);
  }

  actualSize(): void {
    this.pageViewer.actualSize();
  }

  clearSelection(): void {
    this.pageViewer.clearSelection();
    this.emitState();
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

  goToPage(pageIndex: number): Promise<void> | void {
    assertPageIndex(pageIndex);
    return this.goPage(pageIndex);
  }

  async showThumbnails(): Promise<void> {
    if (!this.file || !this.page || !this.pageCount) {
      return;
    }
    this.thumbnailRun += 1;
    this.thumbnailKeep = new Set();
    this.viewMode = "thumbnails";
    this.thumbnailViewer.show(this.pageCount, this.page.sourceName, this.page, this.thumbnails, this.page.pageIndex, this.thumbnailMetadata());
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
    await this.loadPage(pageIndex);
  }

  private async loadPage(pageIndex: number) {
    if (!this.file) {
      return;
    }
    const runId = this.runId + 1;
    this.runId = runId;
    this.setStatus("loadingPage");
    try {
      const page = await this.toPage(await this.decoder.decode(this.file, pageIndex));
      if (runId !== this.runId) {
        URL.revokeObjectURL(page.url);
        return;
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
      this.setStatus("ready");
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private showView(viewMode: AuroraLensViewMode) {
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
      this.decoder.thumbnail(file, pageIndex, size).then((page) => this.toPage(page, size)).then((thumbnail) => {
        this.thumbnailJobs.delete(pageIndex);
        if (run !== this.thumbnailRun || this.viewMode !== "thumbnails" || !this.thumbnailKeep.has(pageIndex)) {
          URL.revokeObjectURL(thumbnail.url);
          return;
        }
        this.thumbnails[pageIndex] = thumbnail;
        this.thumbnailViewer.update(this.thumbnails, this.state().pageIndex, this.thumbnailMetadata());
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
    const pages = new Set<number>();
    for (let index = 0; index < this.pageCount; index += 1) {
      if (this.metadata.hasPage(index)) {
        pages.add(index);
      }
    }
    return pages;
  }

  private setStatus(status: AuroraLensStatus) {
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

  private state(): AuroraLensState {
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

  private async toPage(page: RasterPage, maxSize?: number) {
    const size = this.targetSize(page, maxSize);
    return {
      sourceName: page.sourceName,
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
      pageCount: page.pageCount,
      width: size.width,
      height: size.height,
      url: await this.toUrl(page, size.width, size.height),
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

  private toUrl(page: RasterPage, width: number, height: number) {
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
    return new Promise<string>((resolve, reject) => {
      output.toBlob((blob) => {
        if (!blob) {
          reject(new Error("AuroraLens: canvas did not produce a PNG blob."));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    });
  }
}
