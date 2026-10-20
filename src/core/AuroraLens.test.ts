const pageSize = {
  formats: [
    { name: "letter", width: 8.5, height: 11 },
    { name: "legal", width: 8.5, height: 14 },
    { name: "a4", width: 8.27, height: 11.69 },
  ],
  tolerance: 0.02,
} as const;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuroraLens } from "./AuroraLens";
import { textMetadata } from "../../tests/fixtures/textMetadata";
import { ACTIVE_VIEWER_SESSION_ID, insertPageRecords } from "./session/viewerSessionStore";
import { LENS_ERROR_UNKNOWN } from "./errors/LensError";
import { defaultViewerConfig, type ViewerConfig } from "./config/viewerConfig";
import type { ExportProgress } from "./export/types";
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
    error.name = "LensError";
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
      async decodeDoc(file: File, sink: { pageCount(count: number, type?: string): Promise<void> | void; pageReady(page: ReturnType<typeof page>, importIndex: number): Promise<void> | void }, raster: ViewerConfig["view"], startPage?: () => number) {
        state.decodeCount += 1;
        state.lastRaster = raster;
        if (state.failDecode) {
          throw decoderError("Decode failed.");
        }
        const count = file.name.startsWith("insert") ? 1 : state.pageCount;
        await sink.pageCount(count, "tiff");
        if (startPage) {
          await this.decodePage(file, startPage(), sink, raster);
          return;
        }
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

      async decodePage(file: File, pageIndex: number, sink: { pageReady(page: ReturnType<typeof page>, importIndex: number): Promise<void> | void }, _raster: ViewerConfig["view"]) {
        state.messages.push({ kind: "page", pageIndex });
        if (pageIndex === 1 && state.gatePage) await state.gatePage;
        if (state.failDecode) throw decoderError("Decode failed.");
        await sink.pageReady(page(file.name, pageIndex, 100 + pageIndex, 200 + pageIndex, state.pageCount), pageIndex);
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

const exportMock = vi.hoisted(() => ({
  export: vi.fn(async (_pages: ViewerPageBlobRecord[], _config: ViewerConfig["export"], onProgress?: (progress: ExportProgress) => void) => {
    onProgress?.({ phase: "pages", completed: 1, total: 1 });
    return new Blob([new Uint8Array([1, 2, 3])], { type: "image/tiff" });
  }),
  close: vi.fn(),
}));

vi.mock("./decoder/DocumentDecoder", () => ({
  DocumentDecoder: decoderMock.DocumentDecoder,
}));

vi.mock("./export/TiffExporter", () => ({
  TiffExporter: class {
    export = exportMock.export;
    close = exportMock.close;
  },
}));

let frameId = 0;
let frames = new Map<number, FrameRequestCallback>();

const viewers: AuroraLens[] = [];
function createViewer(...args: ConstructorParameters<typeof AuroraLens>) {
  const viewer = new AuroraLens(...args);
  viewers.push(viewer);
  return viewer;
}

describe("AuroraLens", () => {
  afterEach(() => {
    for (const viewer of viewers.splice(0)) viewer.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("releases the window resize listener when closed", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    const listener = added.mock.calls.find(([name]) => name === "resize")![1];
    lens.close();
    expect(removed).toHaveBeenCalledWith("resize", listener);
  });

  it("waits for a pending clear before opening the next document", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: store });
    await lens.decodeDoc(new File(["raster"], "old.tiff"), { page: 1, viewMode: "page" });
    const remove = store.delete.bind(store);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store, "delete").mockImplementation(async () => { await gate; await remove(); });
    lens.clear();
    const opening = lens.decodeDoc(new File(["raster"], "new.tiff"), { page: 1, viewMode: "page" });
    await flush();
    release();
    await opening;
    await flush();
    expect(store.session?.document.fileName).toBe("new.tiff");
    lens.close();
  });

  it.each([false, true])("ignores a late clipboard completion after clear (reject: %s)", async reject => {
    const states: ViewerState[] = [];
    const onError = vi.fn();
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onError, onStateChange: state => states.push(state) });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "page" });
    lens.search("Alpha");
    let finish!: () => void;
    const clipboard = new Promise<void>((resolve, fail) => { finish = () => reject ? fail(new Error("clipboard failed")) : resolve(); });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => clipboard } });
    const pending = lens.copySelection();
    const completed = reject ? expect(pending).rejects.toThrow("clipboard failed") : expect(pending).resolves.toMatchObject({ copied: true });
    lens.clear();
    finish();
    await completed;
    expect(states.at(-1)).toMatchObject({ status: "idle", pageCount: 0 });
    expect(onError).not.toHaveBeenCalled();
    lens.close();
  });

  it("keeps page order and reports a rejected reorder", async () => {
    const store = new MemorySessionStore();
    const onError = vi.fn();
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store, onError });
    await lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    const original = store.session!.pages.map(page => page.pageId);
    vi.spyOn(store, "reorderPages").mockRejectedValue(new Error("storage failed"));
    drag(handle(container, 1), card(container, 0));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "storage failed" }));
    expect(lens.resolvePage(1)).toBe(0);
    expect(store.session!.pages.map(page => page.pageId)).toEqual(original);
    expect(lens.isDirty()).toBe(false);
    expect(liveText(container)).not.toBe("Reorder page complete");
    lens.close();
  });

  it("keeps page restrictions out of viewer configuration", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    const config = await lens.readViewerConfig();
    expect(config).not.toHaveProperty("formats");
    expect(config).not.toHaveProperty("tolerance");
    await expect(lens.saveViewerConfig(config)).resolves.toEqual(config);
    lens.close();
  });

  it("uses host restrictions during initial and lazy TIFF decoding", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true,
      pageSize: { formats: [{ name: "scan", width: 1, height: 2 }], tolerance: 0.02 },
      sessionStore: store,
    });
    await lens.decodeDoc(new File(["raster"], "scan.tiff"), { page: 1, viewMode: "page" });
    await flush();
    await lens.nextPage();
    await flush();
    expect(store.blobs).toHaveLength(2);
    expect(store.blobs.map(blob => blob.documentType)).toEqual(["scan", "scan"]);
    expect(store.blobs[0]).toMatchObject({ physicalWidth: 1, physicalHeight: 2 });
    lens.close();
  });

  it("rejects lazy TIFF pages outside host tolerance", async () => {
    decoderMock.state.startPageGate();
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true,
      pageSize: { formats: [{ name: "scan", width: 1, height: 2 }], tolerance: 0 },
      sessionStore: store,
    });
    await lens.decodeDoc(new File(["raster"], "scan.tiff"), { page: 1, viewMode: "page" });
    await flush();
    const rejected = expect(lens.goToPage(2)).rejects.toMatchObject({ code: "page_size", details: expect.objectContaining({ sourceName: expect.any(String), pageNumber: expect.any(Number), width: expect.any(Number), height: expect.any(Number), tolerance: expect.any(Number), requiredTolerance: expect.any(Number) }) });
    decoderMock.state.finishPageGate();
    await rejected;
    lens.close();
  });

  it("rejects initial pages outside host restrictions", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true,
      pageSize: { formats: [{ name: "square", width: 1, height: 1 }], tolerance: 0.02 },
      sessionStore: store,
    });
    await expect(lens.decodeDoc(new File(["raster"], "scan.tiff"), { page: 1, viewMode: "page" }))
      .rejects.toMatchObject({ code: "page_size", details: expect.objectContaining({ sourceName: expect.any(String), pageNumber: expect.any(Number), width: expect.any(Number), height: expect.any(Number), tolerance: expect.any(Number), requiredTolerance: expect.any(Number) }) });
    expect(store.blobs).toHaveLength(0);
    lens.close();
  });

  it("uses host restrictions when adding pages and preserves the open document", async () => {
    const store = new MemorySessionStore();
    const onAddError = vi.fn();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true,
      pageSize: { formats: [{ name: "scan", width: 1, height: 2 }], tolerance: 0.02 },
      sessionStore: store,
      onAddError,
    });
    await lens.decodeDoc(new File(["raster"], "scan.tiff"), { page: 1, viewMode: "page" });
    await flush();
    const pages = [...store.session!.pages];
    await expect(lens.addPages([new File(["raster"], "insert.tiff")], 1)).rejects.toMatchObject({ code: "page_size", details: expect.objectContaining({ sourceName: expect.any(String), pageNumber: expect.any(Number), width: expect.any(Number), height: expect.any(Number), tolerance: expect.any(Number), requiredTolerance: expect.any(Number) }) });
    expect(onAddError).toHaveBeenCalledWith(expect.objectContaining({ code: "page_size", details: expect.objectContaining({ sourceName: expect.any(String), pageNumber: expect.any(Number), width: expect.any(Number), height: expect.any(Number), tolerance: expect.any(Number), requiredTolerance: expect.any(Number) }) }));
    expect(store.session!.pages).toEqual(pages.map(page => ({ ...page, updatedAt: expect.any(Number) })));
    lens.close();
  });

  it.each([
    { saved: "A", requested: "A", restored: true },
    { saved: "A", requested: "B", restored: false },
    { saved: undefined, requested: "B", restored: false },
    { saved: "A", requested: undefined, restored: false },
    { saved: undefined, requested: undefined, restored: true },
  ])("checks stored session ownership: $saved -> $requested", async ({ saved, requested, restored }) => {
    const store = new MemorySessionStore();
    const first = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store });
    await first.decodeDoc(new File(["raster"], "A.tiff"), { page: 1, viewMode: "page" });
    await flush();
    first.close();
    store.session!.document.sessionId = saved;
    const states: ViewerState[] = [];
    const errors: Error[] = [];
    const lens = createViewer(document.createElement("div"), {
      allowEdit: false, pageSize, sessionStore: store, sessionId: requested,
      onStateChange: state => states.push(state), onError: error => errors.push(error),
    });
    await expect(lens.restoreSession()).resolves.toBe(restored);
    expect(errors).toEqual([]);
    if (restored) expect(states.at(-1)?.status).toBe("ready");
    else {
      expect(store.session).toBeNull();
      expect(store.blobs).toEqual([]);
      expect(states.some(state => state.status === "ready")).toBe(false);
    }
    lens.close();
  });

  it("persists the requested backend session with decoded pages", async () => {
    const store = new MemorySessionStore();
    const reset = vi.spyOn(store, "resetDocument");
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, sessionId: "A" });
    await lens.decodeDoc(new File(["raster"], "A.tiff"), { page: 1, viewMode: "page" });
    expect(reset).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "A" }));
    await flush();
    lens.close();
  });

  it("waits for mismatched document deletion before reporting a cache miss", async () => {
    const store = new MemorySessionStore();
    const first = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store });
    await first.decodeDoc(new File(["raster"], "A.tiff"), { page: 1, viewMode: "page" });
    await flush(); first.close();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const remove = store.delete.bind(store);
    vi.spyOn(store, "delete").mockImplementation(async () => { await gate; await remove(); });
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, sessionId: "B" });
    let settled = false;
    const restored = lens.restoreSession().then(result => { settled = true; return result; });
    await flush();
    expect(store.delete).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release();
    await expect(restored).resolves.toBe(false);
    expect(store.session).toBeNull(); lens.close();
  });

  it("does not resume a closed viewer after a pending metadata read", async () => {
    const store = new MemorySessionStore();
    const first = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store });
    await first.decodeDoc(new File(["raster"], "A.tiff"), { page: 1, viewMode: "page" });
    await flush(); first.close();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store, "readPageMetadata").mockImplementation(async () => { await gate; return null; });
    const remove = vi.spyOn(store, "delete");
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, onStateChange: state => states.push(state) });
    const restoring = lens.restoreSession();
    await flush(); lens.close(); release();
    await expect(restoring).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(states.some(state => state.status === "ready")).toBe(false);
  });


  it("keeps mapped names tied to pages after reorder and restore", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata({ ...metadata(), pageMap: { "01": 0, "Exhibit-A": 1 } });
    await lens.decodeDoc(new File(["raster"], "ordered.tiff"), { page: "01", viewMode: "page" });
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();
    expect(lens.resolvePage("01")).toBe(1);
    expect(lens.resolvePage("Exhibit-A")).toBe(0);
    lens.close();
    const restored = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: store });
    expect(await restored.restoreSession()).toBe(true);
    expect(restored.resolvePage("01")).toBe(1);
    expect(restored.resolvePage("Exhibit-A")).toBe(0);
    restored.close();
  });

  it.each([-1, 0.5, 2, "1"])("rejects invalid map destination %s", async destination => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata({ ...metadata(), pageMap: { "bad": destination } });
    await expect(lens.decodeDoc(new File(["raster"], "invalid.tiff"), { page: "bad", viewMode: "page" })).rejects.toThrow();
    lens.close();
  });

  it("loads a map after decoding and clears it for the next document", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    await lens.decodeDoc(new File(["raster"], "first.tiff"), { page: 2, viewMode: "page" });
    lens.loadMetadata({ ...metadata(), pageMap: { "26": 1 } });
    expect(lens.resolvePage("26")).toBe(1);
    lens.clear();
    await lens.decodeDoc(new File(["raster"], "second.tiff"), { page: 2, viewMode: "page" });
    expect(lens.resolvePage("2")).toBe(1);
    expect(() => lens.resolvePage("26")).toThrow();
    lens.close();
  });

  it("generates one-based names for an unmapped document and rejects absent names", async () => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "plain.tiff"), { page: 1, viewMode: "page" });
    expect(states.at(-1)?.pageIndex).toBe(0);
    await flush();
    await lens.goToPage("2");
    expect(states.at(-1)?.pageIndex).toBe(1);
    expect(() => lens.resolvePage("missing")).toThrow();
    expect(() => lens.resolvePage(0)).toThrow();
    expect(() => lens.resolvePage(3)).toThrow();
    lens.close();
  });

  it("uses numeric names when a supplied map has no matching name", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata({ ...metadata(), pageMap: { "26": 1 } });
    await lens.decodeDoc(new File(["raster"], "partial.tiff"), { page: 1, viewMode: "page" });
    expect(lens.resolvePage(1)).toBe(0);
    expect(lens.resolvePage("26")).toBe(1);
    lens.close();
  });

  beforeEach(() => {
    decoderMock.state.reset();
    vi.clearAllMocks();
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
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext() {
        return { drawImage: vi.fn(), getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }) };
      }
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

  it("displays page 10 first and only prefetches adjacent pages", async () => {
    decoderMock.state.pageCount = 20;
    const store = new MemorySessionStore();
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 10, viewMode: "page" });
    expect(states.at(-1)).toMatchObject({ pageIndex: 9, status: "ready", pageCount: 20 });
    expect(decoderMock.state.messages[0].pageIndex).toBe(9);
    await flush();
    expect(decoderMock.state.messages.map(value => value.pageIndex)).toEqual([9, 10, 8]);
    expect(store.blobs).toHaveLength(3);
    expect((lens as any).memoryBlobs.size).toBe(0);
    expect((lens as any).thumbnails.filter(Boolean)).toHaveLength(0);
    lens.close();
  });

  it("loads an uncached page and restores a sparse document without losing page identity", async () => {
    decoderMock.state.pageCount = 20;
    const store = new MemorySessionStore();
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 10, viewMode: "page" });
    await flush();
    await lens.goToPage(20);
    expect(states.at(-1)).toMatchObject({ pageIndex: 19, status: "ready" });
    await flush();
    lens.close();
    const restored = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, onStateChange: state => states.push(state) });
    expect(await restored.restoreSession()).toBe(true);
    await restored.goToPage(1);
    expect(states.at(-1)).toMatchObject({ pageIndex: 0, status: "ready" });
    expect(store.session?.pages[0].pageId).toBe("page-1");
    restored.close();
  });

  it("bounds memory without IndexedDB and re-decodes evicted pages", async () => {
    decoderMock.state.pageCount = 20;
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 10, viewMode: "page" });
    await flush();
    await lens.goToPage(20);
    await flush();
    expect((lens as any).memoryBlobs.size).toBeLessThanOrEqual(3);
    await lens.goToPage(10);
    expect(states.at(-1)).toMatchObject({ pageIndex: 9, status: "ready" });
    expect(decoderMock.state.messages.filter(value => value.pageIndex === 9)).toHaveLength(2);
    lens.close();
  });

  it("does not cache an encoded TIFF page larger than the memory byte budget", async () => {
    decoderMock.state.pageCount = 1;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => {
      const blob = new Blob(["png"], { type: "image/png" });
      Object.defineProperty(blob, "size", { value: 65 * 1024 * 1024 });
      callback(blob);
    });
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "large.tiff"), { page: 1, viewMode: "page" });
    expect((lens as any).memoryBlobs.size).toBe(0);
    expect(states.at(-1)).toMatchObject({ status: "ready", pageIndex: 0 });
    lens.close();
  });

  it("exports every sparse page in document order, including edits", async () => {
    decoderMock.state.pageCount = 20;
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: store });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 10, viewMode: "page" });
    await flush();
    await lens.addPages([new File(["insert"], "insert.tiff")], 1);
    await lens.exportTiff();
    const pages = exportMock.export.mock.calls.at(-1)![0];
    expect(pages.map(page => page.pageId)).toEqual(store.session!.pages.map(page => page.pageId));
    expect(pages).toHaveLength(22);
    expect(pages[1].width).toBe(85);
    lens.close();
  });

  it("does not resume prefetch after clear while a decode is pending", async () => {
    decoderMock.state.pageCount = 20;
    decoderMock.state.startPageGate();
    const store = new MemorySessionStore();
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 1, viewMode: "page" });
    await flush();
    lens.clear();
    decoderMock.state.finishPageGate();
    await flush();
    expect(states.at(-1)).toMatchObject({ pageCount: 0, status: "idle" });
    expect(store.blobs).toHaveLength(0);
  });

  it("prioritizes a new destination over the rest of an obsolete prefetch window", async () => {
    decoderMock.state.pageCount = 20;
    decoderMock.state.startPageGate();
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: new MemorySessionStore(), onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 1, viewMode: "page" });
    await flush();
    const first = lens.goToPage(10);
    const last = lens.goToPage(20);
    decoderMock.state.finishPageGate();
    await Promise.all([first, last]);
    await flush();
    expect(states.at(-1)).toMatchObject({ status: "ready", pageIndex: 19 });
    expect(decoderMock.state.messages.map(value => value.pageIndex)).not.toContain(8);
    expect(decoderMock.state.messages.map(value => value.pageIndex)).not.toContain(9);
    lens.close();
  });

  it("does not start decoding after close during configuration loading", async () => {
    const store = new MemorySessionStore();
    let resolve!: (config: ViewerConfig) => void;
    vi.spyOn(store, "readViewerConfig").mockReturnValue(new Promise(done => { resolve = done; }));
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store });
    const opening = lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 1, viewMode: "page" });
    const rejected = expect(opening).rejects.toMatchObject({ name: "AbortError" });
    lens.close();
    resolve(defaultViewerConfig());
    await rejected;
    expect(decoderMock.state.decodeCount).toBe(0);
  });

  it("reports an uncached navigation decode failure and clears the invalid session", async () => {
    decoderMock.state.pageCount = 20;
    const errors: Error[] = [];
    const states: ViewerState[] = [];
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: store, onError: error => errors.push(error), onStateChange: state => states.push(state) });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 10, viewMode: "page" });
    await flush();
    decoderMock.state.failDecode = true;
    await expect(lens.goToPage(20)).rejects.toThrow("Decode failed.");
    expect(states.at(-1)).toMatchObject({ status: "error", pageCount: 0 });
    expect(errors.at(-1)?.message).toBe("Decode failed.");
    expect(store.session).toBeNull();
  });

  it("releases bitmap and canvas storage after cached navigation", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: false, pageSize, sessionStore: new MemorySessionStore() });
    await lens.decodeDoc(new File(["raster"], "many.tiff"), { page: 1, viewMode: "page" });
    await flush();
    vi.mocked(createImageBitmap).mockClear();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockClear();
    await lens.goToPage(2);
    const bitmap = await vi.mocked(createImageBitmap).mock.results[0].value;
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    lens.close();
  });

  it("loads one decoded page and reports stable state", async () => {
    const states: ViewerState[] = [];
    const statuses: ViewerStatus[] = [];
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      onStateChange: (state) => states.push(state),
      onStatusChange: (status) => statuses.push(status),
    });

    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

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

  it("opens decoded document in thumbnails view when requested", async () => {
    const states: ViewerState[] = [];
    const container = document.createElement("div");
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      onStateChange: (state) => states.push(state),
    });

    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "thumbnails" });
    await flush();

    expect(states.at(-1)).toMatchObject({
      viewMode: "thumbnails",
      status: "ready",
      sourceName: "sample.raster",
      pageIndex: 0,
      pageCount: 2,
    });
    expect(container.querySelectorAll("button[data-page-select='true']")).toHaveLength(2);
  });

  it("saves loaded document sessions from package-owned storage", async () => {
    const metadataValue = metadata();
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });
    const file = new File(["raster"], "stored.raster", { type: "image/tiff" });

    lens.loadMetadata(metadataValue);
    await lens.decodeDoc(file, { page: 1, viewMode: "page" });
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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
      onStatusChange: (status) => statuses.push(status),
    });
    const file = new File(["raster"], "stored.raster", { type: "image/tiff" });

    lens.loadMetadata(metadataValue);
    await lens.decodeDoc(file, { page: 1, viewMode: "page" });

    expect(statuses.at(-1)).toBe("ready");
    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1"]);
    expect(store.metadata.map((page) => page.pageId)).toEqual(["page-1", "page-2"]);

    decoderMock.state.finishPageGate();
    await flush();

    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1", "page-2"]);
    expect(store.metadata.map((page) => page.pageId)).toEqual(["page-1", "page-2"]);
  });

  it("clears the viewer and reports errors when remaining page storage fails", async () => {
    const errors: Error[] = [];
    const statuses: ViewerStatus[] = [];
    const store = new FailingSaveStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
      onError: (error) => errors.push(error),
      onStatusChange: (status) => statuses.push(status),
    });

    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
      onError: (error) => errors.push(error),
    });
    const error = await lens.decodeDoc(new File(["bad"], "bad.tiff", { type: "image/tiff" }), { page: 1, viewMode: "page" }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: LENS_ERROR_UNKNOWN, message: "Decode failed." });
    expect(store.session).toBeNull();
    expect(store.blobs).toEqual([]);
    expect(store.metadata).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("updates package-owned session storage when pages change", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await flush();
    await lens.nextPage();

    expect(store.session?.document.currentPageId).toBe("page-2");
  });

  it("reads default viewer config without package-owned storage", async () => {
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize });

    await expect(lens.readViewerConfig()).resolves.toEqual(defaultViewerConfig());
  });

  it("updates package-owned viewer config storage", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });
    const config: ViewerConfig = {
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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });

    expect(decoderMock.state.lastRaster).toEqual(store.viewerConfig.view);
  });

  it("preserves the open document after saving viewer config", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });
    const config: ViewerConfig = {
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

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await flush();
    await lens.nextPage();
    await flush();
    expect(decoderMock.state.decodeCount).toBe(1);

    await expect(lens.saveViewerConfig(config)).resolves.toEqual(config);

    expect(decoderMock.state.decodeCount).toBe(1);
    expect(await lens.readViewerConfig()).toEqual(config);
    expect(store.session?.currentPage.sourcePageIndex).toBe(1);
  });

  it("preserves edited page identities, metadata and dirty state when saving settings", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "page" });
    await lens.addPages([new File(["insert"], "insert.tiff")], 1);
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();
    const pages = store.session!.pages.map(page => page.pageId);
    const blobs = [...store.blobs];
    const savedMetadata = [...store.metadata];
    const config = defaultViewerConfig();
    config.view.pdfRasterDpi = 75;
    config.export.tiff.pixelFormat = "gray8";
    await lens.saveViewerConfig(config);
    expect(store.session!.pages.map(page => page.pageId)).toEqual(pages);
    expect(store.blobs).toEqual(blobs);
    expect(store.metadata).toEqual(savedMetadata);
    expect(lens.isDirty()).toBe(true);
    await lens.exportTiff();
    expect(exportMock.export).toHaveBeenLastCalledWith(expect.any(Array), config.export, undefined);
    await lens.addPages([new File(["insert"], "insert-next.tiff")], pages.length);
    expect(decoderMock.state.lastRaster).toEqual(config.view);
    lens.close();
  });

  it("returns false for a new viewer with no document", () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });

    expect(lens.isDirty()).toBe(false);
  });

  it("returns false after opening a document", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });

    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    expect(lens.isDirty()).toBe(false);
  });

  it("returns true after adding pages", async () => {
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: new MemorySessionStore(),
    });

    await lens.decodeDoc(new File(["stored"], "stored.raster"), { page: 1, viewMode: "page" });
    await lens.addPages([new File(["insert"], "insert.tiff", { type: "image/tiff" })], 1);

    expect(lens.isDirty()).toBe(true);
  });

  it("returns true after removing an original page", async () => {
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: new MemorySessionStore(),
    });

    await lens.decodeDoc(new File(["stored"], "stored.raster"), { page: 1, viewMode: "page" });
    await flush();
    await (lens as unknown as { removePage: (pageId: string) => Promise<void> }).removePage("page-1");

    expect(lens.isDirty()).toBe(true);
  });

  it("returns true after reordering pages", async () => {
    const container = document.createElement("div");
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: new MemorySessionStore(),
    });

    await lens.decodeDoc(new File(["stored"], "stored.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();

    expect(lens.isDirty()).toBe(true);
  });

  it("returns false when pages are reordered back to baseline", async () => {
    const container = document.createElement("div");
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: new MemorySessionStore(),
    });

    await lens.decodeDoc(new File(["stored"], "stored.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();
    drag(handle(container, 0), card(container, 1));
    await flush();

    expect(lens.isDirty()).toBe(false);
  });

  it("returns false after adding then removing added pages", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["stored"], "stored.raster"), { page: 1, viewMode: "page" });
    const baselinePageIds = store.session?.pages.map((page) => page.pageId) ?? [];
    await lens.addPages([new File(["insert"], "insert.tiff", { type: "image/tiff" })], 1);
    const addedPageIds = store.session?.pages
      .map((page) => page.pageId)
      .filter((pageId) => !baselinePageIds.includes(pageId)) ?? [];

    for (const pageId of addedPageIds) {
      await (lens as unknown as { removePage: (pageId: string) => Promise<void> }).removePage(pageId);
    }

    expect(lens.isDirty()).toBe(false);
  });

  it("returns true when an original page is removed and replaced with different pages", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["stored"], "stored.raster"), { page: 1, viewMode: "page" });
    await flush();
    await (lens as unknown as { removePage: (pageId: string) => Promise<void> }).removePage("page-1");
    await flush();
    await lens.addPages([new File(["insert"], "insert.tiff", { type: "image/tiff" })], 0);

    expect(lens.isDirty()).toBe(true);
  });

  it("returns false immediately after restoring a session", async () => {
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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.restoreSession();

    expect(lens.isDirty()).toBe(false);
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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await flush();
    const progress = vi.fn();
    const blob = await lens.exportTiff(progress);

    expect(blob.type).toBe("image/tiff");
    await expect(blob.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(exportMock.export).toHaveBeenCalledWith(
      [expect.objectContaining({ pageId: store.session!.pages[0].pageId })],
      store.viewerConfig.export,
      progress,
    );
    expect(progress).toHaveBeenCalledWith({ phase: "pages", completed: 1, total: 1 });
  });

  it("rejects TIFF export before a document is open", async () => {
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: new MemorySessionStore(),
    });

    await expect(lens.exportTiff()).rejects.toThrow("AuroraLens.exportTiff: open a document before exporting.");
  });

  it.each(["close", "clear"] as const)("closes the exporter on %s", (action) => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: new MemorySessionStore() });
    lens[action]();
    expect(exportMock.close).toHaveBeenCalledTimes(1);
  });

  it("does not start an export worker after closing during stored-page reads", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: store });
    await lens.decodeDoc(new File(["raster"], "stored.tiff", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await flush();
    let resolve!: (record: ViewerPageBlobRecord) => void;
    vi.spyOn(store, "readPageBlobRecord").mockReturnValue(new Promise((done) => { resolve = done; }));
    const result = lens.exportTiff();
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    lens.close();
    resolve(store.blobs[0]);
    await rejected;
    expect(exportMock.export).not.toHaveBeenCalled();
  });

  it("updates package-owned page sequence when thumbnails are reordered", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
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
    const statuses: ViewerStatus[] = [];
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
      onStatusChange: (status) => statuses.push(status),
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
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
    expect(statuses).toContain("addingPages");
  });

  it("keeps successful imported pages and removes failed pending pages", async () => {
    const errors: Error[] = [];
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    decoderMock.state.partialImport = true;
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: store,
      onAddError: (error) => errors.push(error),
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await flush();
    await lens.showThumbnails();
    const error = await lens.addPages([new File(["insert"], "insert.tiff", { type: "image/tiff" })], 1).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: LENS_ERROR_UNKNOWN, message: "Import failed." });
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
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    lens.loadMetadata(firstPageMetadata());
    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: store,
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    runFrames();
    await flush();

    const grid = thumbnailGrid(container);
    grid.scrollTop = 128;
    const images = Array.from(container.querySelectorAll("[data-thumbnail-media] img"));
    images.forEach((image, index) => image.setAttribute("data-probe-id", `image-${index}`));

    drag(handle(container, 1), card(container, 0));
    await flush();

    expect(grid.scrollTop).toBe(128);
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img")).map((image) => image.getAttribute("data-probe-id"))).toEqual(["image-1", "image-0"]);
  });

  it("navigates through reordered package-owned page sequence", async () => {
    decoderMock.state.pageCount = 3;
    const states: ViewerState[] = [];
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      sessionStore: store,
      onStateChange: (state) => states.push(state),
    });

    await lens.decodeDoc(new File(["raster"], "stored.raster", { type: "image/tiff" }), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();
    await lens.goToPage(1);
    await lens.nextPage();
    await flush();

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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
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
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      sessionStore: store,
      onError: (error) => errors.push(error),
    });

    await expect(lens.restoreSession()).resolves.toBe(false);

    expect(store.deleted).toBe(true);
    expect(errors.at(-1)?.message).toBe("Could not restore the previous viewer session.");
  });

  it("exports selected value and context without writing to the clipboard", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    lens.search("Alpha");
    expect(lens.exportSelection()).toEqual([
        {
          value: {
            token: ["ALPHA"],
            context: ["ALPHA BETA"],
            kind: ["BODY"],
          },
        },
    ]);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies only selected value text", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    lens.search("Alpha");
    const result = await lens.copySelection();

    expect(result).toMatchObject({ copied: true, text: "ALPHA" });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ALPHA");
    expect(result.groups[0].value.context).toEqual(["ALPHA BETA"]);
  });

  it("does not write to the clipboard when nothing is selected", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    expect(lens.exportSelection()).toEqual([]);
    expect(await lens.copySelection()).toEqual({ copied: false, groups: [], text: "" });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(lens.readPageName()).toBeNull();
  });

  it("returns the mapped page name for export, including after restore", async () => {
    const store = new MemorySessionStore();
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata({ ...metadata(), pageMap: { "01": 0, "26": 1, "Exhibit-A": 1 } });
    await lens.decodeDoc(new File(["raster"], "mapped.tiff"), { page: "Exhibit-A", viewMode: "page" });
    expect(lens.readPageName()).toBe("Exhibit-A");
    lens.close();

    const restored = createViewer(document.createElement("div"), { allowEdit: true, pageSize, sessionStore: store });
    expect(await restored.restoreSession()).toBe(true);
    await restored.goToPage("Exhibit-A");
    expect(restored.readPageName()).toBe("Exhibit-A");
  });

  it("provides current page metadata info through the public API", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

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
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    const hits = lens.search("Source", { context: "The opening source URLs from the PDF are clean." });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["source"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["The opening source URLs from the PDF are clean."]);
  });

  it("matches search context by explicit AND token terms", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    const hits = lens.search("Source", { context: "opening AND clean" });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["source"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["The opening source URLs from the PDF are clean."]);
  });

  it("matches search context by explicit OR token terms", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    const hits = lens.search("Source", { context: "actual OR clean" });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["source", "source"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual([
      "Now let me look at the actual source URLs from the PDF to build the reference list properly.",
      "The opening source URLs from the PDF are clean.",
    ]);
  });

  it("returns matched context when context search has no token match", async () => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    const hits = lens.search("MissingToken", { context: "The opening source URLs from the PDF are clean." });

    expect(hits?.tokens).toEqual([]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["The opening source URLs from the PDF are clean."]);
    expect(states.at(-1)?.selectionCounts.context).toBe(1);
  });

  it("falls back to token search when context search has no match", async () => {
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    const hits = lens.search("Alpha", { context: "MissingContext" });

    expect(hits?.tokens.map((token) => token.token)).toEqual(["Alpha"]);
    expect(hits?.contexts.map((context) => context.content)).toEqual(["Alpha Beta"]);
  });

  it("highlights one ranked index occurrence while text Search finds all occurrences", async () => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    expect("searchIndex" in lens).toBe(false);
    lens.loadMetadata(textMetadata("seller recorder alphx bravo", "seller recorder alpha bravo alpha bravo"));
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    expect(lens.highlightIndex(1, { label: "Name", value: "bravo alpha", source: "seller recorder", ambiguous: "NO" })).toBe(true);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 2, context: 1, figures: 0 });
    expect(lens.exportSelection()).toEqual([{ value: {
      token: ["ALPHA", "BRAVO"], context: ["SELLER RECORDER ALPHA BRAVO ALPHA BRAVO"], kind: ["BODY"],
    } }]);
    expect((await lens.copySelection()).text).toBe("ALPHA BRAVO");
    const hits = lens.search("alpha bravo");
    expect(hits?.tokens.map(token => token.token)).toEqual(["alphx", "bravo", "alpha", "bravo", "alpha", "bravo"]);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 6, context: 2, figures: 0 });
    expect(lens.highlightIndex(1, { label: "Name", value: "bravo alpha", source: "seller recorder", ambiguous: "NO" })).toBe(true);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 2, context: 1, figures: 0 });
    lens.clearSelection();
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 0, context: 0, figures: 0 });
    lens.close();
  });

  it.each([false, true])("Index Highlight returns a boolean and handles failure with additive=%s", async additive => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    const index = { label: "Name", value: "Beta Alpha", source: "Alpha Beta", ambiguous: "NO" };
    expect(lens.highlightIndex(1, index)).toBe(false);
    const data = metadata();
    data.pages[0].tokens.splice(1, 0, { content: "Beta", confidence: 0.98, polygon: [45, 10, 70, 10, 70, 30, 45, 30] });
    lens.loadMetadata(data);
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    expect(lens.highlightIndex(1, index)).toBe(true);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 2, context: 1, figures: 0 });
    expect(lens.highlightIndex(1, { ...index, source: "Missing Source", value: "Absent Name" }, { additive })).toBe(false);
    expect(states.at(-1)?.selectionCounts).toEqual(additive ? { tokens: 2, context: 1, figures: 0 } : { tokens: 0, context: 0, figures: 0 });
    lens.close();
  });

  it.each([
    ["alpha", "seller recorder", true, 1, 1],
    ["absent", "seller recorder", true, 0, 1],
    ["", "seller recorder", true, 0, 1],
    ["bravo alpha", "", true, 2, 0],
    ["bravo alpha", "unmatched source", true, 2, 0],
    ["absent", "unmatched source", false, 0, 0],
  ] as const)("Index Highlight reports source or value matches: value=%s source=%s", async (value, source, found, tokens, context) => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    lens.loadMetadata(textMetadata("seller recorder alpha", "seller recorder bravo"));
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    expect(lens.highlightIndex(1, { label: "Name", value, source, ambiguous: "NO" })).toBe(found);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens, context, figures: 0 });
    expect(states.at(-1)?.canCopy).toBe(tokens > 0);
    expect(lens.exportSelection()).toHaveLength(tokens > 0 ? tokens : 0);
    lens.close();
  });

  it.each([false, true])("Index Highlight preserves additive and replacement behavior for paragraph-only matches: %s", async additive => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    lens.loadMetadata(textMetadata("seller recorder alpha", "beneficiary bravo"));
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    expect(lens.highlightIndex(1, { label: "Name", value: "alpha", source: "seller recorder", ambiguous: "NO" })).toBe(true);
    expect(lens.highlightIndex(1, { label: "Name", value: "absent", source: "beneficiary", ambiguous: "NO" }, { additive })).toBe(true);
    expect(states.at(-1)?.selectionCounts).toEqual(additive ? { tokens: 1, context: 2, figures: 0 } : { tokens: 0, context: 1, figures: 0 });
    lens.clearSelection();
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 0, context: 0, figures: 0 });
    lens.close();
  });

  it("Index Highlight enforces the active page and named page mapping without navigation", async () => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    const data = textMetadata("seller recorder alpha");
    data.pages.push(textMetadata("beneficiary bravo").pages[0]);
    lens.loadMetadata({ ...data, pageMap: { "Exhibit-A": 0, "Exhibit-B": 1 } });
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: "Exhibit-A", viewMode: "page" });
    const index = { label: "Name", value: "absent", source: "seller recorder", ambiguous: "NO" };
    expect(lens.highlightIndex("Exhibit-A", index)).toBe(true);
    expect(lens.highlightIndex("Exhibit-B", index)).toBe(false);
    expect(states.at(-1)?.pageIndex).toBe(0);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 0, context: 1, figures: 0 });
    lens.close();
  });

  it.each([false, true])("ignores periods and commas while preserving exports and additive=%s", async additive => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    lens.loadMetadata(textMetadata("Wells Fargo Bank, N.A.", "Trustee"));
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });

    expect(lens.search("WELLS FARGO BANK NA")?.tokens.map(token => token.token)).toEqual(["Wells", "Fargo", "Bank,", "N.A."]);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 4, context: 1, figures: 0 });
    expect(lens.exportSelection()).toEqual([{ value: {
      token: ["WELLS", "FARGO", "BANK,", "N.A."],
      context: ["WELLS FARGO BANK, N.A."],
      kind: ["BODY"],
    } }]);
    expect(await lens.copySelection()).toMatchObject({ copied: true, text: "WELLS FARGO BANK, N.A." });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("WELLS FARGO BANK, N.A.");

    expect(lens.highlightIndex(1, { value: "Trustee", source: "Trustee", label: "Name", ambiguous: "NO" }, { additive })).toBe(true);
    expect(states.at(-1)?.selectionCounts).toEqual(additive ? { tokens: 5, context: 2, figures: 0 } : { tokens: 1, context: 1, figures: 0 });
    expect(lens.highlightIndex(1, { value: "NA BANK FARGO WELLS", source: "WELLS FARGO BANK NA", label: "Name", ambiguous: "NO" })).toBe(true);
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 4, context: 1, figures: 0 });
    lens.search(".,");
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 0, context: 0, figures: 0 });
    expect(lens.exportSelection()).toEqual([]);
    lens.close();
  });

  it("uses fuzzy spelling through the public ordered Search API", async () => {
    const states: ViewerState[] = [];
    const data = metadata();
    data.pages[0].tokens[0].content = "Alphx";
    data.pages[0].tokens.splice(1, 0, { content: "Beta", confidence: 0.98, polygon: [45, 10, 70, 10, 70, 30, 45, 30] });
    const lens = createViewer(document.createElement("div"), { allowEdit: true, pageSize, onStateChange: state => states.push(state) });
    lens.loadMetadata(data);
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    expect(lens.search("Alpha Beta")?.tokens.map(token => token.token)).toEqual(["Alphx", "Beta"]);
    expect(lens.search("Beta Alpha")).toEqual({ tokens: [], contexts: [], figures: [] });
    expect(states.at(-1)?.selectionCounts).toEqual({ tokens: 0, context: 0, figures: 0 });

  });

  it("clears selection when navigating pages", async () => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, {
      allowEdit: true, pageSize,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await flush();

    await lens.showThumbnails();
    runFrames();
    await flush();

    expect(container.querySelectorAll("button[data-page-select='true']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-thumbnail-media] img")).toHaveLength(2);
    expect(decoderMock.state.messages.map((message) => message.pageIndex)).toEqual([0, 1]);
    lens.close();
  });

  it.each(["resolve", "reject"])("replaces pending thumbnail jobs when reopening after %s", async (completion) => {
    const container = document.createElement("div");
    const onError = vi.fn();
    const lens = createViewer(container, { allowEdit: true, pageSize, onError });
    await lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "thumbnails" });
    const bitmap = vi.mocked(createImageBitmap).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(createImageBitmap).mockImplementationOnce(async (...args) => {
      await gate;
      if (completion === "reject") throw new Error("Cancelled thumbnail");
      return bitmap(...args);
    });
    runFrames();
    await flush();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 3; index++) {
      await lens.showThumbnails();
      runFrames();
    }
    release();
    await flush();

    expect(container.querySelectorAll("[data-thumbnail-media] img")).toHaveLength(2);
    expect(createImageBitmap).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    thumbnailGrid(container).dispatchEvent(new Event("scroll"));
    await flush();
    expect(createImageBitmap).toHaveBeenCalledTimes(3);
    lens.close();
  });

  it("renders thumbnails when reopening after decoding with a pending session write", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    let save!: () => void;
    let render!: () => void;
    const saveGate = new Promise<void>((resolve) => { save = resolve; });
    const renderGate = new Promise<void>((resolve) => { render = resolve; });
    const saveCurrentPage = store.saveCurrentPage.bind(store);
    vi.spyOn(store, "saveCurrentPage").mockImplementationOnce(async (...args) => {
      await saveGate;
      return saveCurrentPage(...args);
    });
    const bitmap = vi.mocked(createImageBitmap).getMockImplementation()!;
    vi.mocked(createImageBitmap).mockImplementationOnce(async (...args) => { await renderGate; return bitmap(...args); });
    const opening = lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "thumbnails" });
    await flush();
    expect(store.saveCurrentPage).toHaveBeenCalledTimes(1);
    runFrames();
    await flush();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    save();
    await opening;
    await lens.showThumbnails();
    runFrames();
    render();
    await flush();
    expect(container.querySelectorAll("[data-thumbnail-media] img")).toHaveLength(2);
    lens.close();
  });

  it("does not let an old thumbnail completion release its replacement job", async () => {
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize });
    await lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "thumbnails" });
    const bitmap = vi.mocked(createImageBitmap).getMockImplementation()!;
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
    vi.mocked(createImageBitmap)
      .mockImplementationOnce(async (...args) => { await oldGate; return bitmap(...args); })
      .mockImplementationOnce(async (...args) => { await newGate; return bitmap(...args); });
    runFrames();
    await flush();
    await lens.showThumbnails();
    runFrames();
    releaseOld();
    await flush();
    thumbnailGrid(container).dispatchEvent(new Event("scroll"));
    releaseNew();
    await flush();

    expect(container.querySelectorAll("[data-thumbnail-media] img")).toHaveLength(2);
    expect(createImageBitmap).toHaveBeenCalledTimes(3);
    lens.close();
  });

  it.each(["close", "replace", "navigate"])("discards pending thumbnails on %s", async (action) => {
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize });
    await lens.decodeDoc(new File(["raster"], "first.tiff"), { page: 1, viewMode: "thumbnails" });
    const bitmap = vi.mocked(createImageBitmap).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(createImageBitmap).mockImplementationOnce(async (...args) => { await gate; return bitmap(...args); });
    runFrames();
    await flush();
    if (action === "close") lens.close();
    if (action === "replace") await lens.decodeDoc(new File(["raster"], "second.tiff"), { page: 1, viewMode: "thumbnails" });
    if (action === "navigate") {
      await lens.goToPage(2);
      await lens.showThumbnails();
    }
    runFrames();
    release();
    await flush();

    const images = container.querySelectorAll("[data-thumbnail-media] img");
    expect(images).toHaveLength(action === "close" ? 0 : 2);
    if (action === "replace") expect(Array.from(images, (image) => image.getAttribute("alt"))).toEqual(["second.tiff page 1", "second.tiff page 2"]);
    lens.close();
  });

  it("retains completed thumbnails when reopened and renders the restored document", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    await lens.decodeDoc(new File(["raster"], "sample.tiff"), { page: 1, viewMode: "thumbnails" });
    runFrames();
    await flush();
    const urls = Array.from(container.querySelectorAll("[data-thumbnail-media] img"), (image) => image.getAttribute("src"));
    expect(urls).toHaveLength(2);
    vi.mocked(createImageBitmap).mockClear();
    await lens.showThumbnails();
    runFrames();
    await flush();
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img"), (image) => image.getAttribute("src"))).toEqual(urls);
    expect(createImageBitmap).not.toHaveBeenCalled();
    lens.close();

    const restored = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    expect(await restored.restoreSession()).toBe(true);
    await restored.showThumbnails();
    runFrames();
    await flush();
    expect(container.querySelectorAll("[data-thumbnail-media] img")).toHaveLength(2);
    restored.close();
  });

  it("keeps the thumbnail watermark outside the scrolling grid", async () => {
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: false, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await flush();

    await lens.showThumbnails();

    const root = thumbnailRoot(container);
    const grid = thumbnailGrid(container);
    const watermark = Array.from(root.querySelectorAll("span")).find((span) => span.textContent === "Powered by Tabularium AI");
    expect(root.style.overflow).toBe("hidden");
    expect(grid.style.overflow).toBe("auto");
    expect(watermark?.parentElement).toBe(root);
    expect(grid.contains(watermark ?? null)).toBe(false);
  });

  it("adds a decoded TIFF page to the left of the selected card", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const file = new File(["insert"], "insert.tiff", { type: "image/tiff" });
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    runFrames();
    await flush();

    action(container, 0, "Add after").click();
    chooseFile(container, new File(["insert"], "insert.tiff", { type: "image/tiff" }));
    await flush();
    runFrames();
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, {
      allowEdit: false, pageSize,      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();

    action(container, 0, "Add after").click();
    chooseFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
  });

  it("removes a thumbnail and persists the page removal", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();

    action(container, 0, "Remove").click();
    vi.advanceTimersByTime(3000);

    expect(action(container, 0, "Remove").style.color).toBe("rgb(180, 35, 24)");
    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    vi.useRealTimers();
  });

  it("reorders thumbnails visually", async () => {
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();

    drag(handle(container, 0), card(container, 1));
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    expect(liveText(container)).toBe("Reorder page complete");
  });

  it("uses grab and grabbing cursor states while dragging thumbnails", async () => {
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
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
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    const grid = thumbnailGrid(container);
    Object.defineProperty(grid, "getBoundingClientRect", {
      value: () => ({ bottom: 200, height: 200, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0, toJSON: () => ({}) }),
    });
    grid.scrollTop = 500;

    dragStart(handle(container, 19));
    dragOver(grid, 4);
    runFrames();

    expect(grid.scrollTop).toBeLessThan(500);
    card(container, 19).dispatchEvent(new Event("dragend", { bubbles: true }));
    const scrollTop = grid.scrollTop;
    runFrames();
    expect(grid.scrollTop).toBe(scrollTop);
  });

  it("auto-scrolls thumbnail grid downward during thumbnail drag", async () => {
    decoderMock.state.pageCount = 20;
    const container = document.createElement("div");
    const lens = createViewer(container, { allowEdit: true, pageSize });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();
    const grid = thumbnailGrid(container);
    Object.defineProperty(grid, "getBoundingClientRect", {
      value: () => ({ bottom: 200, height: 200, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0, toJSON: () => ({}) }),
    });

    dragStart(handle(container, 0));
    dragOver(grid, 196);
    runFrames();

    expect(grid.scrollTop).toBeGreaterThan(0);
  });

  it("adds decoded TIFF pages at the end for dropped files", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const file = new File(["insert"], "insert.tiff", { type: "image/tiff" });
    const lens = createViewer(container, { allowEdit: true, pageSize, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await lens.showThumbnails();

    dropFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    expect(liveText(container)).toBe("Add pages complete");
    expect(lens.resolvePage(4)).toBe(3);
  });

  it("opens a selected page through the public page API", async () => {
    const states: ViewerState[] = [];
    const lens = createViewer(document.createElement("div"), {
      allowEdit: true, pageSize,
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeDoc(new File(["raster"], "sample.raster"), { page: 1, viewMode: "page" });
    await flush();

    await lens.goToPage(2);

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

function thumbnailGrid(container: HTMLElement) {
  const grid = Array.from(thumbnailRoot(container).children).find((child) => child instanceof HTMLDivElement);
  if (!(grid instanceof HTMLElement)) {
    throw new Error("Missing thumbnail grid.");
  }
  return grid;
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
  const grid = thumbnailGrid(container);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [file],
      types: ["Files"],
    },
  });
  grid.dispatchEvent(event);
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
        sessionId: input.sessionId,
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
