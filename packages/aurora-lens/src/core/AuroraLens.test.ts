import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuroraLens } from "./AuroraLens";
import { ACTIVE_VIEWER_SESSION_ID, insertPageRecords } from "./viewerSessionStore";
import { DECODER_ERROR_UNKNOWN } from "./DecoderError";
import { defaultViewerConfig, type ViewerConfig } from "./viewerConfig";
import type { ViewerDocumentInput, ViewerPageBlobRecord, ViewerPageMetadataRecord, ViewerPageRecord, ViewerSession, ViewerSessionStore, ViewerState, ViewerStatus, RasterPage } from "./types";

const decoderMock = vi.hoisted(() => {
  function page(sourceName: string, pageIndex: number, width: number, height: number, pageCount: number) {
    return {
      sourceName,
      sourceType: "tiff",
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount,
      width,
      height,
      pixels: new Uint8ClampedArray(width * height * 4),
      xResolution: width / 8.5,
      yResolution: height / 11,
    };
  }

  function decoderError(message: string) {
    const error = new Error(message) as Error & { code: string };
    error.name = "DecoderError";
    error.code = "unknown";
    return error;
  }

  const state = {
    pageCount: 2,
    messages: [] as Array<{ kind: "page"; pageIndex: number }>,
    decodeCount: 0,
    failDecode: false,
    partialImport: false,
    gatePage: null as Promise<void> | null,
    resolvePage: (() => undefined) as () => void,
    importGate: false,
    importSink: null as { pageReady(page: ReturnType<typeof page>, importIndex: number): Promise<void> | void } | null,
    resolveImport: (() => undefined) as () => void,
    lastRaster: null as ViewerConfig["view"] | null,
    reset() {
      this.pageCount = 2;
      this.messages = [];
      this.decodeCount = 0;
      this.failDecode = false;
      this.partialImport = false;
      this.gatePage = null;
      this.resolvePage = () => undefined;
      this.importGate = false;
      this.importSink = null;
      this.resolveImport = () => undefined;
      this.lastRaster = null;
    },
    startPageGate() {
      this.gatePage = new Promise<void>((resolve) => {
        this.resolvePage = resolve;
      });
    },
    finishPageGate() {
      this.resolvePage();
    },
    startImportGate() {
      this.importGate = true;
      this.importSink = null;
    },
    async finishImportGate() {
      if (!this.importSink) {
        throw new Error("Import did not start.");
      }
      await this.importSink.pageReady(page("insert.tiff", 0, 85, 110, 2), 0);
      await this.importSink.pageReady(page("insert.tiff", 1, 85, 110, 2), 1);
      this.importGate = false;
      this.resolveImport();
    },
  };

  return {
    state,
    DocumentDecoder: class DocumentDecoder {
      async decodeDoc(file: File, sink: { pageCount(count: number): Promise<void> | void; pageReady(page: ReturnType<typeof page>, importIndex: number): Promise<void> | void }, raster: ViewerConfig["view"]) {
        state.decodeCount += 1;
        state.lastRaster = raster;
        if (state.failDecode) {
          throw decoderError("Decode failed.");
        }
        const count = file.name.startsWith("insert") ? 1 : state.pageCount;
        await sink.pageCount(count);
        for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
          state.messages.push({ kind: "page", pageIndex });
          if (pageIndex === 1 && state.gatePage) {
            await state.gatePage;
          }
          const width = file.name.startsWith("insert") ? 85 : 100 + pageIndex;
          const height = file.name.startsWith("insert") ? 110 : 200 + pageIndex;
          await sink.pageReady(page(file.name, pageIndex, width, height, count), pageIndex);
        }
      }

      async decodeDocs(files: File[], sink: { pageCount(count: number): Promise<void> | void; pageReady(page: ReturnType<typeof page>, importIndex: number): Promise<void> | void }, raster: ViewerConfig["view"]) {
        state.lastRaster = raster;
        if (state.partialImport) {
          await sink.pageCount(3);
          await sink.pageReady(page("insert.tiff", 0, 85, 110, 3), 0);
          throw decoderError("Import failed.");
        }
        if (state.importGate) {
          await sink.pageCount(2);
          state.importSink = sink;
          return new Promise<void>((resolve) => {
            state.resolveImport = resolve;
          });
        }
        const pages = files.flatMap((file) => [
          page(file.name, 0, 85, 110, 2),
          page(file.name, 1, 85, 110, 2),
        ]);
        await sink.pageCount(pages.length);
        for (let index = 0; index < pages.length; index += 1) {
          await sink.pageReady(pages[index], index);
        }
      }

      close() {}
    },
  };
});

const tiffMock = vi.hoisted(() => {
  const state = {
    addCalls: [] as Array<{
      compression: number;
      height: number;
      pixelFormat: number;
      width: number;
      xResolution: number;
      yResolution: number;
    }>,
    nextPointer: 8,
    reset() {
      this.addCalls = [];
      this.nextPointer = 8;
    },
  };
  const module = {
    HEAPU8: new Uint8Array(1_000_000),
    _malloc(size: number) {
      const pointer = state.nextPointer;
      state.nextPointer += size + 8;
      return pointer;
    },
    _free: vi.fn(),
    _TiffWriterAddRGBA(_writer: number, _pointer: number, width: number, height: number, compression: number, pixelFormat: number, _resolutionUnit: number, xResolution: number, yResolution: number) {
      state.addCalls.push({
        compression,
        height,
        pixelFormat,
        width,
        xResolution,
        yResolution,
      });
      return 1;
    },
    _TiffWriterCreate: vi.fn(() => 64),
    _TiffWriterDestroy: vi.fn(),
    _TiffWriterFinish(_writer: number, sizePointer: number) {
      module.HEAPU8[sizePointer] = 3;
      module.HEAPU8[sizePointer + 1] = 0;
      module.HEAPU8[sizePointer + 2] = 0;
      module.HEAPU8[sizePointer + 3] = 0;
      module.HEAPU8.set([1, 2, 3], 128);
      return 128;
    },
    _TiffFreeMemory: vi.fn(),
  };
  return { module, state };
});

vi.mock("./documentDecoder/DocumentDecoder", () => ({
  DocumentDecoder: decoderMock.DocumentDecoder,
}));

vi.mock("./documentDecoder/vendor/auroraTiff.js", () => ({
  default: vi.fn(() => Promise.resolve(tiffMock.module)),
}));

let frameId = 0;
let frames = new Map<number, FrameRequestCallback>();

describe("AuroraLens", () => {
  beforeEach(() => {
    decoderMock.state.reset();
    tiffMock.state.reset();
    frameId = 0;
    frames = new Map();
    let pageId = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      pageId += 1;
      return `page-${pageId}` as `${string}-${string}-${string}-${string}-${string}`;
    });
    vi.stubGlobal("ImageData", class ImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal("createImageBitmap", vi.fn((blob: Blob) => Promise.resolve({
      width: (blob as Blob & { mockWidth?: number }).mockWidth ?? 85,
      height: (blob as Blob & { mockHeight?: number }).mockHeight ?? 110,
      close: vi.fn(),
    })));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:page"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        drawImage: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        putImageData: vi.fn(),
        restore: vi.fn(),
        save: vi.fn(),
        setTransform: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: vi.fn(function toBlob(this: HTMLCanvasElement, callback: BlobCallback) {
        const blob = new Blob(["png"], { type: "image/png" });
        Object.defineProperty(blob, "mockWidth", { value: this.width });
        Object.defineProperty(blob, "mockHeight", { value: this.height });
        callback(blob);
      }),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("loads one decoded page and reports stable state", async () => {
    const states: ViewerState[] = [];
    const statuses: ViewerStatus[] = [];
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      onStateChange: (state) => states.push(state),
      onStatusChange: (status) => statuses.push(status),
    });

    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    expect(statuses).toContain("loadingPage");
    expect(statuses.at(-1)).toBe("ready");
    expect(states.at(-1)).toMatchObject({
      viewMode: "page",
      status: "ready",
      sourceName: "sample.raster",
      pageIndex: 0,
      pageCount: 2,
      pageWidth: 100,
      pageHeight: 200,
      canGoNext: true,
    });
  });

  it("saves loaded document sessions from package-owned storage", async () => {
    const metadataValue = metadata();
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });
    const file = new File(["raster"], "stored.raster", { type: "image/tiff" });

    lens.loadMetadata(metadataValue);
    await lens.decodeDoc(file, 0);
    await flush();

    expect(store.session?.document).toMatchObject({
      id: ACTIVE_VIEWER_SESSION_ID,
      fileName: "stored.raster",
      fileType: "image/tiff",
      fileBlob: file,
      currentPageId: "page-1",
    });
    expect(store.session?.pages.map((page) => ({ pageId: page.pageId, sequenceNumber: page.sequenceNumber, sourcePageIndex: page.sourcePageIndex }))).toEqual([
      { pageId: "page-1", sequenceNumber: 1, sourcePageIndex: 0 },
      { pageId: "page-2", sequenceNumber: 2, sourcePageIndex: 1 },
    ]);
    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1", "page-2"]);
    expect(store.metadata.map((page) => page.pageId)).toEqual(["page-1", "page-2"]);
  });

  it("shows the first page before remaining page storage completes", async () => {
    const metadataValue = metadata();
    const statuses: ViewerStatus[] = [];
    decoderMock.state.startPageGate();
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
      onStatusChange: (status) => statuses.push(status),
    });
    const file = new File(["raster"], "stored.raster", { type: "image/tiff" });

    lens.loadMetadata(metadataValue);
    await lens.decodeDoc(file, 0);

    expect(statuses.at(-1)).toBe("ready");
    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1"]);
    expect(store.metadata.map((page) => page.pageId)).toEqual(["page-1"]);

    decoderMock.state.finishPageGate();
    await flush();

    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1", "page-2"]);
    expect(store.metadata.map((page) => page.pageId)).toEqual(["page-1", "page-2"]);
  });

  it("clears the viewer and reports errors when remaining page storage fails", async () => {
    const errors: Error[] = [];
    const statuses: ViewerStatus[] = [];
    const store = new FailingSaveStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
      onError: (error) => errors.push(error),
      onStatusChange: (status) => statuses.push(status),
    });

    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();

    expect(store.deleted).toBe(true);
    expect(statuses.at(-1)).toBe("error");
    expect(errors.at(-1)?.message).toBe("Remaining page storage failed.");
    expect(lens.search("Builders")).toBeNull();
  });

  it("clears stored pages and bubbles main document decode errors", async () => {
    const errors: Error[] = [];
    const store = new MemorySessionStore(sessionRecord());
    store.blobs = [
      pageBlob("page-1"),
      pageBlob("page-2"),
    ];
    decoderMock.state.failDecode = true;
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
      onError: (error) => errors.push(error),
    });
    const error = await lens.decodeDoc(new File(["bad"], "bad.tiff", { type: "image/tiff" }), 0).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: DECODER_ERROR_UNKNOWN, message: "Decode failed." });
    expect(store.session).toBeNull();
    expect(store.blobs).toEqual([]);
    expect(store.metadata).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("updates package-owned session storage when pages change", async () => {
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();
    await lens.nextPage();

    expect(store.session?.document.currentPageId).toBe("page-2");
  });

  it("reads default viewer config without package-owned storage", async () => {
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true });

    await expect(lens.readViewerConfig()).resolves.toEqual(defaultViewerConfig());
  });

  it("updates package-owned viewer config storage", async () => {
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });
    const config: ViewerConfig = {
      formats: [
        { name: "letter", width: 8.5, height: 11 },
      ],
      tolerance: 0.01,
      view: {
        pdfRasterDpi: 125,
        maxRasterPixels: 30_000_000,
        maxRasterWidth: 9_000,
        maxRasterHeight: 9_000,
      },
      export: {
        pdfRasterDpi: 300,
        maxRasterPixels: 160_000_000,
        maxRasterWidth: 20_000,
        maxRasterHeight: 20_000,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    };

    await expect(lens.readViewerConfig()).resolves.toEqual(defaultViewerConfig());
    await expect(lens.saveViewerConfig(config)).resolves.toEqual(config);
    await expect(lens.readViewerConfig()).resolves.toEqual(config);
  });

  it("passes view raster config to package decoder", async () => {
    const store = new MemorySessionStore();
    store.viewerConfig = {
      formats: [
        { name: "letter", width: 8.5, height: 11 },
      ],
      tolerance: 0.01,
      view: {
        pdfRasterDpi: 125,
        maxRasterPixels: 30_000_000,
        maxRasterWidth: 9_000,
        maxRasterHeight: 9_000,
      },
      export: {
        pdfRasterDpi: 300,
        maxRasterPixels: 160_000_000,
        maxRasterWidth: 20_000,
        maxRasterHeight: 20_000,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    };
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);

    expect(decoderMock.state.lastRaster).toEqual(store.viewerConfig.view);
  });

  it("re-decodes the open document after saving viewer config", async () => {
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });
    const config: ViewerConfig = {
      formats: [
        { name: "letter", width: 8.5, height: 11 },
      ],
      tolerance: 0.01,
      view: {
        pdfRasterDpi: 75,
        maxRasterPixels: 20_000_000,
        maxRasterWidth: 5_000,
        maxRasterHeight: 5_000,
      },
      export: {
        pdfRasterDpi: 300,
        maxRasterPixels: 160_000_000,
        maxRasterWidth: 20_000,
        maxRasterHeight: 20_000,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    };

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();
    await lens.nextPage();
    await flush();
    expect(decoderMock.state.decodeCount).toBe(1);

    await expect(lens.saveViewerConfig(config)).resolves.toEqual(config);

    expect(decoderMock.state.decodeCount).toBe(2);
    expect(decoderMock.state.lastRaster).toEqual(config.view);
    expect(store.session?.currentPage.sourcePageIndex).toBe(1);
  });

  it("exports stored pages as TIFF using package export config", async () => {
    decoderMock.state.pageCount = 1;
    const store = new MemorySessionStore();
    store.viewerConfig = {
      ...defaultViewerConfig(),
      export: {
        ...defaultViewerConfig().export,
        pdfRasterDpi: 10,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    };
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();
    const blob = await lens.exportTiff();

    expect(blob.type).toBe("image/tiff");
    await expect(blob.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(tiffMock.state.addCalls).toEqual([
      {
        compression: 5,
        height: 110,
        pixelFormat: 24,
        width: 85,
        xResolution: 10,
        yResolution: 10,
      },
    ]);
  });

  it("rejects TIFF export before a document is open", async () => {
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: new MemorySessionStore(),
    });

    await expect(lens.exportTiff()).rejects.toThrow("AuroraLens.exportTiff: open a document before exporting.");
  });

  it("updates package-owned page sequence when thumbnails are reordered", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();

    expect(store.session?.pages.map((page) => ({
      pageId: page.pageId,
      sequenceNumber: page.sequenceNumber,
      sourcePageIndex: page.sourcePageIndex,
    }))).toEqual([
      { pageId: "page-2", sequenceNumber: 1, sourcePageIndex: 1 },
      { pageId: "page-1", sequenceNumber: 2, sourcePageIndex: 0 },
    ]);
  });

  it("stores inserted TIFF pages in package-owned page order", async () => {
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();
    await lens.addPages([new File(["insert"], "insert.tiff", { type: "image/tiff" })], 1);

    expect(store.session?.pages.map((page) => ({
      pageId: page.pageId,
      sequenceNumber: page.sequenceNumber,
      sourcePageIndex: page.sourcePageIndex,
    }))).toEqual([
      { pageId: "page-1", sequenceNumber: 1, sourcePageIndex: 0 },
      { pageId: "page-3", sequenceNumber: 2, sourcePageIndex: 0 },
      { pageId: "page-4", sequenceNumber: 3, sourcePageIndex: 1 },
      { pageId: "page-2", sequenceNumber: 4, sourcePageIndex: 1 },
    ]);
    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1", "page-2", "page-3", "page-4"]);
    expect(store.session?.document.currentPageId).toBe("page-1");
  });

  it("keeps successful imported pages and removes failed pending pages", async () => {
    const errors: Error[] = [];
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    decoderMock.state.partialImport = true;
    const lens = new AuroraLens(container, {
      allowEdit: true,
      sessionStore: store,
      onAddError: (error) => errors.push(error),
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();
    await lens.showThumbnails();
    const error = await lens.addPages([new File(["insert"], "insert.tiff", { type: "image/tiff" })], 1).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: DECODER_ERROR_UNKNOWN, message: "Import failed." });
    expect(errors).toEqual([error]);
    expect(store.session?.pages.map((page) => ({
      pageId: page.pageId,
      sequenceNumber: page.sequenceNumber,
      sourcePageIndex: page.sourcePageIndex,
    }))).toEqual([
      { pageId: "page-1", sequenceNumber: 1, sourcePageIndex: 0 },
      { pageId: "page-3", sequenceNumber: 2, sourcePageIndex: 0 },
      { pageId: "page-2", sequenceNumber: 3, sourcePageIndex: 1 },
    ]);
    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1", "page-2", "page-3"]);
    expect(store.session?.document.currentPageId).toBe("page-1");
    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("keeps intelligence labels tied to page identity after thumbnail reorder", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      sessionStore: store,
    });

    lens.loadMetadata(firstPageMetadata());
    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.showThumbnails();

    expect(intelligenceLabels(container)).toEqual(["Page 1 has intelligence metadata"]);
    expect(card(container, 0).style.borderTop).toBe("0.25rem solid rgb(124, 58, 237)");

    drag(handle(container, 0), card(container, 1));
    await flush();

    expect(Array.from(container.querySelectorAll("[data-item-id]")).map((card) => (card as HTMLElement).dataset.itemId)).toEqual(["page-2", "page-1"]);
    expect(intelligenceLabels(container)).toEqual(["Page 2 has intelligence metadata"]);
    expect(card(container, 1).style.borderTop).toBe("0.25rem solid rgb(124, 58, 237)");
  });

  it("keeps thumbnail scroll and image nodes when thumbnails are reordered", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.showThumbnails();
    runFrames();
    await flush();

    const root = thumbnailRoot(container);
    root.scrollTop = 128;
    const images = Array.from(container.querySelectorAll("[data-thumbnail-media] img"));
    images.forEach((image, index) => image.setAttribute("data-probe-id", `image-${index}`));

    drag(handle(container, 1), card(container, 0));
    await flush();

    expect(root.scrollTop).toBe(128);
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img")).map((image) => image.getAttribute("data-probe-id"))).toEqual(["image-1", "image-0"]);
  });

  it("navigates through reordered package-owned page sequence", async () => {
    decoderMock.state.pageCount = 3;
    const states: ViewerState[] = [];
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      sessionStore: store,
      onStateChange: (state) => states.push(state),
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();
    await lens.goToPage(0);
    await lens.nextPage();

    expect(decoderMock.state.messages.map((message) => message.pageIndex)).toEqual([0, 1, 2]);
    expect(states.at(-1)).toMatchObject({
      pageIndex: 1,
      pageWidth: 100,
      pageHeight: 200,
    });
    expect(store.session?.document.currentPageId).toBe("page-1");
  });

  it("restores package-owned viewer sessions", async () => {
    const states: ViewerState[] = [];
    const metadataValue = metadata();
    const fileBlob = new Blob(["raster"], { type: "image/tiff" });
    const pages = pageRecords(2);
    const store = new MemorySessionStore({
      document: {
        id: ACTIVE_VIEWER_SESSION_ID,
        fileName: "restored.raster",
        fileType: "image/tiff",
        fileBlob,
        currentPageId: "page-2",
        updatedAt: 1,
      },
      pages,
      currentPage: pages[1],
    });
    store.metadata = [
      { pageId: "page-1", metadata: metadataValue.pages[0], updatedAt: 1 },
      { pageId: "page-2", metadata: metadataValue.pages[1], updatedAt: 1 },
    ];
    store.blobs = [
      pageBlob("page-1"),
      pageBlob("page-2"),
    ];
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
      onStateChange: (state) => states.push(state),
    });

    await expect(lens.restoreSession()).resolves.toBe(true);

    expect(states.at(-1)).toMatchObject({
      sourceName: "restored.raster",
      pageIndex: 1,
      pageCount: 2,
      metadataPageCount: 2,
      canSearch: true,
    });
    expect(store.session).toMatchObject({
      document: {
        fileName: "restored.raster",
        currentPageId: "page-2",
      },
    });
  });

  it("reports corrupt package-owned viewer sessions", async () => {
    const errors: Error[] = [];
    const store = new FailingReadSessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      sessionStore: store,
      onError: (error) => errors.push(error),
    });

    await expect(lens.restoreSession()).resolves.toBe(false);

    expect(store.deleted).toBe(true);
    expect(errors.at(-1)?.message).toBe("Could not restore the previous viewer session.");
  });

  it("copies selected tokens in grouped JSON shape", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    lens.search("Alpha");
    const result = await lens.copySelection();

    expect(result).toEqual({
      copied: true,
      groups: [
        {
          value: {
            token: ["ALPHA"],
            context: ["ALPHA BETA"],
            kind: ["BODY"],
          },
        },
      ],
      text: JSON.stringify(
        [
          {
            value: {
              token: ["ALPHA"],
              context: ["ALPHA BETA"],
              kind: ["BODY"],
            },
          },
        ],
        null,
        2
      ),
    });
  });

  it("provides current page metadata info through the public API", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    expect(lens.readPageInfo()).toEqual({
      pageNumber: 1,
      class: "assumed name abandonment",
      segments: ["Exhibit", "Recital"],
      indexes: [
        {
          label: "Recording Number",
          value: "20250631357",
          source: "Document Number: 20250631357",
          ambiguous: "NO",
        },
      ],
    });
  });

  it("restricts token search to the matched context", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    const hits = lens.search("Source", { context: "The opening source URLs from the PDF are clean." });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["source"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["The opening source URLs from the PDF are clean."]);
  });

  it("matches search context by explicit AND token terms", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    const hits = lens.search("Source", { context: "opening AND clean" });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["source"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["The opening source URLs from the PDF are clean."]);
  });

  it("matches search context by explicit OR token terms", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    const hits = lens.search("Source", { context: "actual OR clean" });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["source", "source"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual([
      "Now let me look at the actual source URLs from the PDF to build the reference list properly.",
      "The opening source URLs from the PDF are clean.",
    ]);
  });

  it("returns matched context when context search has no token match", async () => {
    const states: ViewerState[] = [];
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    const hits = lens.search("MissingToken", { context: "The opening source URLs from the PDF are clean." });

    expect(hits?.tokens).toEqual([]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["The opening source URLs from the PDF are clean."]);
    expect(states.at(-1)?.selectionCounts.context).toBe(1);
  });

  it("falls back to token search when context search has no match", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    const hits = lens.search("Alpha", { context: "MissingContext" });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["Alpha"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["Alpha Beta"]);
  });

  it("searches indexes through the package API", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);

    const hits = lens.searchIndex(1, {
      label: "Recording Number",
      value: "Alpha",
      source: "Document Number: Alpha",
      ambiguous: "NO",
    });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["Alpha"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["Alpha Beta"]);
  });

  it("clears selection when navigating pages", async () => {
    const states: ViewerState[] = [];
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await flush();

    lens.search("Alpha");
    expect(states.at(-1)?.selectionCounts.tokens).toBe(1);

    await lens.nextPage();

    expect(states.at(-1)).toMatchObject({
      pageIndex: 1,
      selectionCounts: {
        tokens: 0,
        figures: 0,
        context: 0,
      },
    });
  });

  it("opens thumbnail selection inside the core viewer", async () => {
    const states: ViewerState[] = [];
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await flush();
    await lens.showThumbnails();

    const pageTwo = Array.from(container.querySelectorAll("button[data-page-select='true']")).find((button) => button.getAttribute("aria-label") === "Page 2");
    pageTwo?.click();
    await flush();

    expect(states.at(-1)).toMatchObject({
      viewMode: "page",
      pageIndex: 1,
    });
  });

  it("shows stored thumbnails from decoded document pages", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await flush();

    await lens.showThumbnails();

    expect(container.querySelectorAll("button[data-page-select='true']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-thumbnail-media] img")).toHaveLength(2);
    expect(decoderMock.state.messages.map((message) => message.pageIndex)).toEqual([0, 1]);
    lens.close();
  });

  it("adds a decoded TIFF page to the left of the selected card", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const file = new File(["insert"], "insert.tiff", { type: "image/tiff" });
    const lens = new AuroraLens(container, { allowEdit: true, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 1, "Add before").click();
    chooseFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    expect(decoderMock.state.messages.filter((message) => message.kind === "page").map((message) => message.pageIndex)).toEqual([0, 1]);
    expect(liveText(container)).toBe("Add page complete");
  });

  it("shows empty thumbnail cards before imported pages are ready", async () => {
    const store = new MemorySessionStore();
    decoderMock.state.startImportGate();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Add after").click();
    chooseFile(container, new File(["insert"], "insert.tiff", { type: "image/tiff" }));
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    expect(container.querySelectorAll("[aria-label$='thumbnail loading']")).toHaveLength(2);

    await decoderMock.state.finishImportGate();
    await flush();

    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img")).map((image) => image.getAttribute("alt"))).toContain("insert.tiff page 2");
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img")).map((image) => image.getAttribute("alt"))).toContain("insert.tiff page 3");
  });

  it("scopes thumbnail control visibility to card hover and focus", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const page = card(container, 1);
    const add = action(container, 1, "Add before");
    const style = document.getElementById("aurora-lens-thumbnail-style");
    expect(page.dataset.auroraThumbnailCard).toBe("true");
    expect(page.style.borderTop).toBe("0px");
    expect(add.dataset.thumbnailAction).toBe("true");
    expect(add.style.width).toBe("3rem");
    expect(add.style.height).toBe("3rem");
    expect(add.style.border).toBe("0px");
    expect(add.style.backgroundColor).toBe("rgba(0, 81, 104, 0.12)");
    expect(add.style.color).toBe("rgb(0, 81, 104)");
    expect(add.style.fontWeight).toBe("400");
    expect(add.style.opacity).toBe("");
    expect(add.style.pointerEvents).toBe("");
    expect(add.style.visibility).toBe("");
    expect(style?.textContent).toContain("[data-thumbnail-action]");
    expect(style?.textContent).toContain("[data-aurora-thumbnail-card]:hover [data-thumbnail-action]");
    expect(style?.textContent).toContain("[data-aurora-thumbnail-card]:focus-within [data-thumbnail-action]");
  });

  it("places thumbnail remove and drag controls in their card zones", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const remove = action(container, 0, "Remove");
    const add = action(container, 0, "Add after");
    const move = handle(container, 0);
    const selected = card(container, 0);

    expect(selected.style.borderLeft).toBe("1px solid rgb(0, 81, 104)");
    expect(selected.style.borderTop).toBe("1px solid rgb(0, 81, 104)");
    expect(remove.style.left).toBe("50%");
    expect(remove.style.top).toBe("0.375rem");
    expect(remove.style.transform).toBe("translateX(-50%)");
    expect(remove.textContent).toBe("×");
    expect(remove.style.width).toBe("3rem");
    expect(remove.style.height).toBe("3rem");
    expect(remove.style.fontSize).toBe("1.75rem");
    expect(remove.style.color).toBe("rgb(180, 35, 24)");
    expect(remove.style.border).toBe("0px");
    expect(remove.style.backgroundColor).toBe("rgba(0, 81, 104, 0.12)");
    expect(remove.style.fontWeight).toBe("400");
    expect(add.style.width).toBe("3rem");
    expect(add.style.height).toBe("3rem");
    expect(add.style.fontSize).toBe("1.75rem");
    expect(add.style.color).toBe("rgb(0, 81, 104)");
    expect(move.style.left).toBe("50%");
    expect(move.style.bottom).toBe("0.375rem");
    expect(move.style.transform).toBe("translateX(-50%)");
    expect(move.style.color).toBe("rgb(0, 81, 104)");
    expect(move.style.fontSize).toBe("1rem");
    expect(move.style.fontWeight).toBe("400");
    expect(move.style.boxShadow).toBe("0 1px 4px rgba(17, 24, 39, 0.16)");
  });

  it("hides thumbnail edit controls when editing is not allowed", async () => {
    const states: ViewerState[] = [];
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: false,      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await flush();
    await lens.showThumbnails();

    expect(container.querySelector("[data-thumbnail-action]")).toBeNull();
    expect(container.querySelector("[data-thumbnail-drag-handle]")).toBeNull();

    dropFile(container, new File(["insert"], "insert.tiff", { type: "image/tiff" }));
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);

    const pageTwo = Array.from(container.querySelectorAll("button[data-page-select='true']")).find((button) => button.getAttribute("aria-label") === "Page 2");
    pageTwo?.click();
    await flush();

    expect(states.at(-1)).toMatchObject({
      viewMode: "page",
      pageIndex: 1,
    });
  });

  it("toggles thumbnail edit controls without replacing thumbnail images", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();
    runFrames();
    await flush();

    const images = Array.from(container.querySelectorAll("[data-thumbnail-media] img"));
    expect(images).toHaveLength(2);
    expect(container.querySelector("[data-thumbnail-action]")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector("[data-thumbnail-drag-handle]")).toBeInstanceOf(HTMLElement);

    lens.setAllowEdit(false);

    expect(container.querySelector("[data-thumbnail-action]")).toBeNull();
    expect(container.querySelector("[data-thumbnail-drag-handle]")).toBeNull();
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img"))).toEqual(images);

    lens.setAllowEdit(true);

    expect(container.querySelector("[data-thumbnail-action]")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector("[data-thumbnail-drag-handle]")).toBeInstanceOf(HTMLElement);
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img"))).toEqual(images);
  });

  it("adds a decoded TIFF page to the right of the selected card", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const file = new File(["insert"], "insert.tiff", { type: "image/tiff" });
    const lens = new AuroraLens(container, { allowEdit: true, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Add after").click();
    chooseFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
  });

  it("removes a thumbnail and persists the page removal", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const confirm = action(container, 0, "Remove");
    confirm.click();
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    expect(confirm.getAttribute("aria-label")).toBe("Confirm remove");
    expect(confirm.style.backgroundColor).toBe("rgb(180, 35, 24)");
    expect(confirm.style.width).toBe("auto");
    expect(confirm.style.minWidth).toBe("7rem");
    expect(confirm.style.height).toBe("2rem");
    expect(confirm.style.padding).toBe("0px 0.75rem");
    expect(confirm.style.fontSize).toBe("0.75rem");
    expect(confirm.style.fontWeight).toBe("800");
    expect(confirm.style.whiteSpace).toBe("nowrap");

    confirm.click();
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1"]);
    expect(liveText(container)).toBe("Remove page complete");
    expect(store.session?.pages.map((page) => ({
      sequenceNumber: page.sequenceNumber,
      sourcePageIndex: page.sourcePageIndex,
    }))).toEqual([
      { sequenceNumber: 1, sourcePageIndex: 1 },
    ]);
    expect(store.session?.currentPage.sourcePageIndex).toBe(1);
  });

  it("disarms thumbnail remove confirmation after timeout", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Remove").click();
    vi.advanceTimersByTime(3000);

    expect(action(container, 0, "Remove").style.color).toBe("rgb(180, 35, 24)");
    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    vi.useRealTimers();
  });

  it("reorders thumbnails visually", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    drag(handle(container, 0), card(container, 1));
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    expect(liveText(container)).toBe("Reorder page complete");
  });

  it("uses grab and grabbing cursor states while dragging thumbnails", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const source = card(container, 0);
    const target = card(container, 1);
    const select = source.querySelector("[data-page-select='true']");
    const handle = source.querySelector("[data-thumbnail-drag-handle='true']");
    const style = document.getElementById("aurora-lens-thumbnail-style");
    expect(select).toBeInstanceOf(HTMLButtonElement);
    expect(handle).toBeInstanceOf(HTMLButtonElement);
    expect((select as HTMLElement).style.cursor).toBe("pointer");
    expect((handle as HTMLElement).style.width).toBe("3.75rem");
    expect((handle as HTMLElement).style.height).toBe("1.75rem");
    expect((handle as HTMLElement).style.border).toBe("0px");
    expect((handle as HTMLElement).style.backgroundColor).toBe("rgba(0, 81, 104, 0.12)");
    expect((handle as HTMLElement).style.cursor).toBe("grab");
    expect(style?.textContent).toContain("[data-aurora-thumbnail-card][data-drag-state=\"dragging\"]");
    expect(style?.textContent).toContain("cursor: grabbing");
    expect(style?.textContent).toContain("[data-thumbnail-drag-handle]");
    expect(style?.textContent).toContain("[data-aurora-thumbnail-card][data-drop-target=\"true\"]");

    dragStart(handle as HTMLElement);
    expect(source.dataset.dragState).toBe("dragging");
    dragOver(target);
    expect(target.dataset.dropTarget).toBe("true");
    source.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(source.dataset.dragState).toBeUndefined();
    expect(target.dataset.dropTarget).toBeUndefined();
  });

  it("uses current card identity for drop targets after thumbnail reorder", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    drag(handle(container, 1), card(container, 0));
    await flush();

    const movedCard = card(container, 0);
    const source = handle(container, 1);
    dragStart(source);
    dragOver(movedCard);

    expect(movedCard.dataset.dropTarget).toBe("true");
    expect(card(container, 1).dataset.dropTarget).toBeUndefined();
  });

  it("auto-scrolls thumbnail grid upward during thumbnail drag", async () => {
    decoderMock.state.pageCount = 20;
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();
    const root = thumbnailRoot(container);
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ bottom: 200, height: 200, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0, toJSON: () => ({}) }),
    });
    root.scrollTop = 500;

    dragStart(handle(container, 19));
    dragOver(root, 4);
    runFrames();

    expect(root.scrollTop).toBeLessThan(500);
    card(container, 19).dispatchEvent(new Event("dragend", { bubbles: true }));
    const scrollTop = root.scrollTop;
    runFrames();
    expect(root.scrollTop).toBe(scrollTop);
  });

  it("auto-scrolls thumbnail grid downward during thumbnail drag", async () => {
    decoderMock.state.pageCount = 20;
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();
    const root = thumbnailRoot(container);
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ bottom: 200, height: 200, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0, toJSON: () => ({}) }),
    });

    dragStart(handle(container, 0));
    dragOver(root, 196);
    runFrames();

    expect(root.scrollTop).toBeGreaterThan(0);
  });

  it("adds decoded TIFF pages at the end for dropped files", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const file = new File(["insert"], "insert.tiff", { type: "image/tiff" });
    const lens = new AuroraLens(container, { allowEdit: true, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    dropFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    expect(liveText(container)).toBe("Add pages complete");
  });

  it("opens a selected page through the public page API", async () => {
    const states: ViewerState[] = [];
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), 0);
    await flush();

    await lens.goToPage(1);

    expect(states.at(-1)).toMatchObject({
      viewMode: "page",
      pageIndex: 1,
      pageWidth: 101,
      pageHeight: 201,
    });
  });
});

function rasterPage(sourceName: string, pageIndex: number, width: number, height: number, pageCount = decoderMock.state.pageCount): RasterPage {
  return {
    sourceName,
    sourceType: "tiff",
    pageIndex,
    pageNumber: pageIndex + 1,
    pageCount,
    width,
    height,
    pixels: new Uint8ClampedArray(width * height * 4),
    xResolution: width / 8.5,
    yResolution: height / 11,
  };
}
function pageBlob(pageId: string): ViewerPageBlobRecord {
  return {
    pageId,
    blob: new Blob(["png"], { type: "image/png" }),
    sourceType: "tiff",
    width: 85,
    height: 110,
    xResolution: 10,
    yResolution: 10,
    documentType: "letter",
    physicalWidth: 8.5,
    physicalHeight: 11,
    updatedAt: 1,
  };
}

function metadata() {
  return {
    pages: [
      {
        pageNumber: 1,
        width: 100,
        height: 200,
        class: "assumed name abandonment",
        segments: ["Exhibit", "Recital"],
        indexes: [
          {
            label: "Recording Number",
            value: "20250631357",
            source: "Document Number: 20250631357",
            ambiguous: "NO",
          },
        ],
        tokens: [
          {
            content: "Alpha",
            confidence: 0.98,
            polygon: [10, 10, 40, 10, 40, 30, 10, 30],
          },
          {
            content: "source",
            confidence: 0.98,
            polygon: [10, 50, 50, 50, 50, 70, 10, 70],
          },
          {
            content: "source",
            confidence: 0.98,
            polygon: [10, 90, 50, 90, 50, 110, 10, 110],
          },
        ],
        contexts: [
          {
            content: "Alpha Beta",
            role: "body",
            polygon: [5, 5, 75, 5, 75, 35, 5, 35],
          },
          {
            content: "Now let me look at the actual source URLs from the PDF to build the reference list properly.",
            role: "body",
            polygon: [5, 45, 95, 45, 95, 75, 5, 75],
          },
          {
            content: "The opening source URLs from the PDF are clean.",
            role: "body",
            polygon: [5, 85, 95, 85, 95, 115, 5, 115],
          },
        ],
        figures: [],
      },
      {
        pageNumber: 2,
        width: 100,
        height: 200,
        tokens: [
          {
            content: "Gamma",
            confidence: 0.98,
            polygon: [10, 10, 50, 10, 50, 30, 10, 30],
          },
        ],
        contexts: [
          {
            content: "Gamma",
            role: "body",
            polygon: [5, 5, 55, 5, 55, 35, 5, 35],
          },
        ],
        figures: [],
      },
    ],
  };
}

function firstPageMetadata() {
  const value = metadata();
  return {
    pages: [value.pages[0]],
  };
}

function card(container: HTMLElement, pageIndex: number) {
  const element = container.querySelector(`[data-page-index="${pageIndex}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing thumbnail card ${pageIndex}.`);
  }
  return element;
}

function action(container: HTMLElement, pageIndex: number, label: string) {
  const button = card(container, pageIndex).querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${label} button.`);
  }
  return button;
}

function handle(container: HTMLElement, pageIndex: number) {
  const button = card(container, pageIndex).querySelector("[data-thumbnail-drag-handle='true']");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Missing thumbnail drag handle.");
  }
  return button;
}

function chooseFile(container: HTMLElement, file: File) {
  const input = container.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Missing thumbnail file input.");
  }
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function thumbnailRoot(container: HTMLElement) {
  const input = container.querySelector("input[type='file']");
  const root = input?.parentElement;
  if (!(root instanceof HTMLElement)) {
    throw new Error("Missing thumbnail root.");
  }
  return root;
}

function cardLabels(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-item-id]")).map((element) => {
    const page = element.querySelector("button[data-page-select='true']");
    if (page) {
      return page.getAttribute("aria-label") ?? "";
    }
    const mock = Array.from(element.querySelectorAll("span")).find((span) => span.textContent === "Added page");
    return mock?.textContent ?? "";
  });
}

function intelligenceLabels(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[aria-label$='has intelligence metadata']")).map((element) => element.getAttribute("aria-label") ?? "");
}

function drag(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = {
    files: [],
    setData: vi.fn(),
    types: [],
  };
  const start = new Event("dragstart", { bubbles: true });
  Object.defineProperty(start, "dataTransfer", {
    value: dataTransfer,
  });
  source.dispatchEvent(start);

  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: dataTransfer,
  });
  target.dispatchEvent(drop);
}

function dragStart(source: HTMLElement) {
  const event = new Event("dragstart", { bubbles: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      effectAllowed: "",
      setData: vi.fn(),
    },
  });
  source.dispatchEvent(event);
}

function dragOver(target: HTMLElement, clientY?: number) {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: [],
    },
  });
  if (clientY !== undefined) {
    Object.defineProperty(event, "clientY", {
      value: clientY,
    });
  }
  target.dispatchEvent(event);
}

function dropFile(container: HTMLElement, file: File) {
  const root = thumbnailRoot(container);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [file],
      types: ["Files"],
    },
  });
  root.dispatchEvent(event);
}

function liveText(container: HTMLElement) {
  return container.querySelector("[aria-live='polite']")?.textContent;
}

function runFrames() {
  const callbacks = Array.from(frames.values());
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}

function flush() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

class MemorySessionStore implements ViewerSessionStore {
  blobs: ViewerPageBlobRecord[] = [];
  metadata: ViewerPageMetadataRecord[] = [];
  viewerConfig: ViewerConfig | null = null;

  constructor(public session: ViewerSession | null = null) {}

  async read() {
    return this.session;
  }

  async resetDocument(input: ViewerDocumentInput) {
    const pages = input.pages;
    this.session = {
      document: {
        id: ACTIVE_VIEWER_SESSION_ID,
        fileName: input.fileName,
        fileType: input.fileType,
        fileBlob: input.fileBlob,
        currentPageId: pages[input.currentPageIndex].pageId,
        updatedAt: input.updatedAt,
      },
      pages,
      currentPage: pages[input.currentPageIndex],
    };
    this.blobs = [];
    this.metadata = [];
    return pages;
  }

  async insertPages(insertIndex: number, pages: ViewerPageRecord[], blobs: ViewerPageBlobRecord[], updatedAt: number) {
    if (!this.session) {
      return [];
    }
    const orderedPages = insertPageRecords(this.session.pages, insertIndex, pages, updatedAt);
    const currentPage = orderedPages.find((page) => page.pageId === this.session?.document.currentPageId)!;
    this.session = {
      ...this.session,
      document: {
        ...this.session.document,
        updatedAt,
      },
      pages: orderedPages,
      currentPage,
    };
    this.blobs.push(...blobs);
    return orderedPages;
  }

  async removePages(pageIds: string[], updatedAt: number) {
    if (!this.session) {
      return [];
    }
    const pageIdSet = new Set(pageIds);
    const orderedPages = this.session.pages
      .filter((page) => !pageIdSet.has(page.pageId))
      .map((value, index) => ({
        ...value,
        sequenceNumber: index + 1,
        updatedAt,
      }));
    const currentPage = orderedPages.find((page) => page.pageId === this.session?.document.currentPageId)!;
    this.session = {
      ...this.session,
      document: {
        ...this.session.document,
        updatedAt,
      },
      pages: orderedPages,
      currentPage,
    };
    this.blobs = this.blobs.filter((record) => !pageIdSet.has(record.pageId));
    this.metadata = this.metadata.filter((record) => !pageIdSet.has(record.pageId));
    return orderedPages;
  }

  async readViewerConfig() {
    return this.viewerConfig ?? defaultViewerConfig();
  }

  async saveCurrentPage(pageId: string, updatedAt: number) {
    if (this.session) {
      const currentPage = this.session.pages.find((page) => page.pageId === pageId)!;
      this.session = {
        ...this.session,
        document: {
          ...this.session.document,
          currentPageId: pageId,
          updatedAt,
        },
        currentPage,
      };
    }
  }

  async savePageBlob(record: ViewerPageBlobRecord) {
    this.blobs.push(record);
  }

  async readPageBlobRecord(pageId: string) {
    return this.blobs.find((record) => record.pageId === pageId) ?? null;
  }

  async savePageMetadata(record: ViewerPageMetadataRecord) {
    this.metadata.push(record);
  }

  async saveViewerConfig(config: ViewerConfig) {
    this.viewerConfig = config;
    return config;
  }

  async reorderPages(fromPageIndex: number, toPageIndex: number, updatedAt: number) {
    if (!this.session) {
      return [];
    }
    const pages = [...this.session.pages];
    const [page] = pages.splice(fromPageIndex, 1);
    pages.splice(toPageIndex, 0, page);
    const orderedPages = pages.map((value, index) => ({
      ...value,
      sequenceNumber: index + 1,
      updatedAt,
    }));
    const currentPage = orderedPages.find((value) => value.pageId === this.session?.document.currentPageId)!;
    this.session = {
      ...this.session,
      pages: orderedPages,
      currentPage,
    };
    return orderedPages;
  }

  async readPageMetadata(pageId: string) {
    return this.metadata.find((record) => record.pageId === pageId)?.metadata ?? null;
  }

  async readPageMetadataIds() {
    return new Set(this.metadata.map((record) => record.pageId));
  }

  async delete() {
    this.session = null;
    this.blobs = [];
    this.metadata = [];
  }
}

class FailingSaveStore extends MemorySessionStore {
  deleted = false;

  async savePageBlob(record: ViewerPageBlobRecord) {
    if (record.pageId === "page-2") {
      throw new Error("Remaining page storage failed.");
    }
    await super.savePageBlob(record);
  }

  async delete() {
    this.deleted = true;
    await super.delete();
  }
}

class FailingReadSessionStore implements ViewerSessionStore {
  deleted = false;

  async resetDocument(_input: ViewerDocumentInput) {
    return [];
  }

  async insertPages(_insertIndex: number, _pages: ViewerPageRecord[], _blobs: ViewerPageBlobRecord[], _updatedAt: number) {
    return [];
  }

  async removePages(_pageIds: string[], _updatedAt: number) {
    return [];
  }

  async saveCurrentPage(_pageId: string, _updatedAt: number) {}

  async savePageBlob(_record: ViewerPageBlobRecord) {}

  async readPageBlobRecord(_pageId: string) {
    return null;
  }

  async savePageMetadata(_record: ViewerPageMetadataRecord) {}

  async readViewerConfig() {
    return defaultViewerConfig();
  }

  async saveViewerConfig(config: ViewerConfig) {
    return config;
  }

  async reorderPages(_fromPageIndex: number, _toPageIndex: number, _updatedAt: number) {
    return [];
  }

  async readPageMetadata(_pageId: string) {
    return null;
  }

  async readPageMetadataIds() {
    return new Set<string>();
  }

  async read(): Promise<ViewerSession | null> {
    throw new Error("Invalid session.");
  }

  async delete() {
    this.deleted = true;
  }
}

function pageRecords(count: number): ViewerPageRecord[] {
  const pages: ViewerPageRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    pages.push({
      pageId: `page-${index + 1}`,
      documentId: ACTIVE_VIEWER_SESSION_ID,
      sequenceNumber: index + 1,
      sourcePageIndex: index,
      updatedAt: 1,
    });
  }
  return pages;
}

function sessionRecord(): ViewerSession {
  const pages = pageRecords(2);
  return {
    document: {
      id: ACTIVE_VIEWER_SESSION_ID,
      fileName: "stored.tiff",
      fileType: "image/tiff",
      fileBlob: new Blob(["stored"], { type: "image/tiff" }),
      currentPageId: "page-1",
      updatedAt: 1,
    },
    pages,
    currentPage: pages[0],
  };
}
