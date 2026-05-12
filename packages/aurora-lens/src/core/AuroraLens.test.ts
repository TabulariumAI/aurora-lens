import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuroraLens } from "./AuroraLens";
import { ACTIVE_VIEWER_SESSION_ID, insertPageRecords } from "./viewerSessionStore";
import type { ViewerDecoder, ViewerDocumentInput, ViewerImportSink, ViewerPageBlobRecord, ViewerPageMetadataRecord, ViewerPageRecord, ViewerSession, ViewerSessionStore, ViewerState, ViewerStatus, RasterPage } from "./types";
import type { PageSizeConfig } from "./pageSizeValidation";

let mockPageCount = 2;
let decoderMessages: Array<{ kind: "page" | "thumbnail"; pageIndex: number }> = [];
let frameId = 0;
let frames = new Map<number, FrameRequestCallback>();

class DecoderMock implements ViewerDecoder {
  async decode(file: File, pageIndex: number) {
    decoderMessages.push({ kind: "page", pageIndex });
    const pageCount = file.name.startsWith("insert") ? 1 : mockPageCount;
    const width = file.name.startsWith("insert") ? 85 : 100 + pageIndex;
    const height = file.name.startsWith("insert") ? 110 : 200 + pageIndex;
    return rasterPage(file.name, pageIndex, width, height, pageCount);
  }

  async importPages(files: File[], sink: ViewerImportSink) {
    const pages = files.flatMap((file) => [
      rasterPage(file.name, 0, 85, 110, 2),
      rasterPage(file.name, 1, 85, 110, 2),
    ]);
    await sink.pageCount(pages.length);
    for (let index = 0; index < pages.length; index += 1) {
      await sink.pageReady(pages[index], index);
    }
  }

  async thumbnail(file: File, pageIndex: number) {
    decoderMessages.push({ kind: "thumbnail", pageIndex });
    return rasterPage(file.name, pageIndex, 32, 48);
  }
}

class GateDecoder implements ViewerDecoder {
  private readonly nextPage: Promise<RasterPage>;
  private resolvePage: (page: RasterPage) => void = () => undefined;

  constructor() {
    this.nextPage = new Promise((resolve) => {
      this.resolvePage = resolve;
    });
  }

  async decode(file: File, pageIndex: number) {
    decoderMessages.push({ kind: "page", pageIndex });
    if (pageIndex === 1) {
      return this.nextPage;
    }
    return rasterPage(file.name, pageIndex, 100 + pageIndex, 200 + pageIndex);
  }

  async thumbnail(file: File, pageIndex: number) {
    decoderMessages.push({ kind: "thumbnail", pageIndex });
    return rasterPage(file.name, pageIndex, 32, 48);
  }

  async importPages(files: File[], sink: ViewerImportSink) {
    await new DecoderMock().importPages(files, sink);
  }

  finish(fileName: string) {
    this.resolvePage(rasterPage(fileName, 1, 101, 201));
  }
}

class ImportGateDecoder extends DecoderMock {
  private sink: ViewerImportSink | null = null;
  private resolveImport: () => void = () => undefined;

  async importPages(_files: File[], sink: ViewerImportSink) {
    this.sink = sink;
    await sink.pageCount(2);
    return new Promise<void>((resolve) => {
      this.resolveImport = resolve;
    });
  }

  async finish() {
    if (!this.sink) {
      throw new Error("Import did not start.");
    }
    await this.sink.pageReady(rasterPage("insert.tiff", 0, 85, 110, 2), 0);
    await this.sink.pageReady(rasterPage("insert.tiff", 1, 85, 110, 2), 1);
    this.resolveImport();
  }
}

describe("AuroraLens", () => {
  beforeEach(() => {
    mockPageCount = 2;
    decoderMessages = [];
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
      value: vi.fn((callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" }))),
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
      decoder: new DecoderMock(),
      onStateChange: (state) => states.push(state),
      onStatusChange: (status) => statuses.push(status),
    });

    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);

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
      decoder: new DecoderMock(),
      sessionStore: store,
    });
    const file = new File(["raster"], "stored.raster", { type: "image/tiff" });

    lens.loadMetadata(metadataValue);
    await lens.decodeTiff(file, 0);
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
    const decoder = new GateDecoder();
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      decoder,
      sessionStore: store,
      onStatusChange: (status) => statuses.push(status),
    });
    const file = new File(["raster"], "stored.raster", { type: "image/tiff" });

    lens.loadMetadata(metadataValue);
    await lens.decodeTiff(file, 0);

    expect(statuses.at(-1)).toBe("ready");
    expect(store.blobs.map((blob) => blob.pageId)).toEqual(["page-1"]);
    expect(store.metadata.map((page) => page.pageId)).toEqual(["page-1"]);

    decoder.finish(file.name);
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
      decoder: new DecoderMock(),
      sessionStore: store,
      onError: (error) => errors.push(error),
      onStatusChange: (status) => statuses.push(status),
    });

    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await flush();

    expect(store.deleted).toBe(true);
    expect(statuses.at(-1)).toBe("error");
    expect(errors.at(-1)?.message).toBe("Remaining page storage failed.");
    expect(lens.search("Builders")).toBeNull();
  });

  it("updates package-owned session storage when pages change", async () => {
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
    });

    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.nextPage();

    expect(store.session?.document.currentPageId).toBe("page-2");
  });

  it("reads default validation config without package-owned storage", async () => {
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      decoder: new DecoderMock(),
    });

    await expect(lens.readPageValidationConfig()).resolves.toEqual({
      formats: [
        { name: "letter", width: 8.5, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
    });
  });

  it("updates package-owned validation config storage", async () => {
    const store = new MemorySessionStore();
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
    });
    const config = {
      formats: [
        { name: "letter", width: 8.5, height: 11 },
      ],
      tolerance: 0.01,
    };

    await expect(lens.readPageValidationConfig()).resolves.toEqual({
      formats: [
        { name: "letter", width: 8.5, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
    });
    await expect(lens.savePageValidationConfig(config)).resolves.toEqual(config);
    await expect(lens.readPageValidationConfig()).resolves.toEqual(config);
  });

  it("updates package-owned page sequence when thumbnails are reordered", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
    });

    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
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
      decoder: new DecoderMock(),
      sessionStore: store,
    });

    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
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

  it("keeps intelligence labels tied to page identity after thumbnail reorder", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
    });

    lens.loadMetadata(firstPageMetadata());
    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.showThumbnails();

    expect(intelligenceLabels(container)).toEqual(["Intelligence ready for page 1"]);

    drag(handle(container, 0), card(container, 1));
    await flush();

    expect(Array.from(container.querySelectorAll("[data-item-id]")).map((card) => (card as HTMLElement).dataset.itemId)).toEqual(["page-2", "page-1"]);
    expect(intelligenceLabels(container)).toEqual(["Intelligence ready for page 2"]);
  });

  it("keeps thumbnail scroll and image nodes when thumbnails are reordered", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
    });

    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
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
    mockPageCount = 3;
    const states: ViewerState[] = [];
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
      onStateChange: (state) => states.push(state),
    });

    await lens.decodeTiff(new File(["raster"], "stored.raster", { type: "image/tiff" }), 0);
    await lens.showThumbnails();
    drag(handle(container, 1), card(container, 0));
    await flush();
    await lens.goToPage(0);
    await lens.nextPage();

    expect(decoderMessages.filter((message) => message.kind === "page").map((message) => message.pageIndex)).toEqual([0, 1, 2, 1, 0]);
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
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      decoder: new DecoderMock(),
      sessionStore: store,
      onStateChange: (state) => states.push(state),
    });

    await expect(lens.restoreSession()).resolves.toBe(true);

    expect(states.at(-1)).toMatchObject({
      sourceName: "restored.raster",
      pageIndex: 1,
      pageCount: 2,
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
      decoder: new DecoderMock(),
      sessionStore: store,
      onError: (error) => errors.push(error),
    });

    await expect(lens.restoreSession()).resolves.toBe(false);

    expect(store.deleted).toBe(true);
    expect(errors.at(-1)?.message).toBe("Could not restore the previous viewer session.");
  });

  it("copies selected tokens in grouped JSON shape", async () => {
    const lens = new AuroraLens(document.createElement("div"), { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);

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

  it("clears selection when navigating pages", async () => {
    const states: ViewerState[] = [];
    const lens = new AuroraLens(document.createElement("div"), {
      allowEdit: true,
      decoder: new DecoderMock(),
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);

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
      decoder: new DecoderMock(),
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const pageTwo = Array.from(container.querySelectorAll("button[data-page-select='true']")).find((button) => button.getAttribute("aria-label") === "Page 2");
    pageTwo?.click();
    await flush();

    expect(states.at(-1)).toMatchObject({
      viewMode: "page",
      pageIndex: 1,
    });
  });

  it("shows thumbnail placeholders before decoding the bounded range", async () => {
    mockPageCount = 30;
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);

    await lens.showThumbnails();

    const placeholders = container.querySelectorAll("[aria-label$='thumbnail loading']");
    expect(container.querySelectorAll("button[data-page-select='true']")).toHaveLength(30);
    expect(placeholders).toHaveLength(30);
    expect(placeholders[0].getAttribute("style")).toContain("aspect-ratio");
    expect(placeholders[0].querySelectorAll("span[aria-hidden='true']")).toHaveLength(1);
    expect((placeholders[0].querySelector("span[aria-hidden='true']") as HTMLElement).style.animation).toContain("aurora-lens-thumbnail-sheen");
    expect(decoderMessages.filter((message) => message.kind === "thumbnail")).toHaveLength(0);

    runFrames();

    const thumbnails = decoderMessages.filter((message) => message.kind === "thumbnail");
    expect(thumbnails.length).toBeGreaterThan(0);
    expect(thumbnails.length).toBeLessThan(30);
    lens.close();
  });

  it("adds a decoded TIFF page to the left of the selected card", async () => {
    const store = new MemorySessionStore();
    const container = document.createElement("div");
    const file = new File(["insert"], "insert.tiff", { type: "image/tiff" });
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock(), sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 1, "Add before").click();
    chooseFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    expect(decoderMessages.filter((message) => message.kind === "page").map((message) => message.pageIndex)).toEqual([0, 1]);
    expect(liveText(container)).toBe("Add page complete");
  });

  it("shows empty thumbnail cards before imported pages are ready", async () => {
    const store = new MemorySessionStore();
    const decoder = new ImportGateDecoder();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder, sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Add after").click();
    chooseFile(container, new File(["insert"], "insert.tiff", { type: "image/tiff" }));
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
    expect(container.querySelectorAll("[aria-label$='thumbnail loading']")).toHaveLength(4);

    await decoder.finish();
    await flush();

    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img")).map((image) => image.getAttribute("alt"))).toContain("insert.tiff page 2");
    expect(Array.from(container.querySelectorAll("[data-thumbnail-media] img")).map((image) => image.getAttribute("alt"))).toContain("insert.tiff page 3");
  });

  it("scopes thumbnail control visibility to card hover and focus", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const page = card(container, 1);
    const add = action(container, 1, "Add before");
    const style = document.getElementById("aurora-lens-thumbnail-style");
    expect(page.dataset.auroraThumbnailCard).toBe("true");
    expect(page.style.border).toBe("0px");
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
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const remove = action(container, 0, "Remove");
    const add = action(container, 0, "Add after");
    const move = handle(container, 0);
    const selected = card(container, 0);

    expect(selected.style.border).toBe("1px solid rgb(0, 81, 104)");
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
      allowEdit: false,
      decoder: new DecoderMock(),
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock(), sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Add after").click();
    chooseFile(container, file);
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);
  });

  it("removes a thumbnail visually", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Remove").click();
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    const confirm = action(container, 0, "Confirm remove");
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

    expect(cardLabels(container)).toEqual(["Page 2"]);
    expect(liveText(container)).toBe("Remove page complete");
  });

  it("disarms thumbnail remove confirmation after timeout", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    action(container, 0, "Remove").click();
    vi.advanceTimersByTime(3000);

    expect(action(container, 0, "Remove").style.color).toBe("rgb(180, 35, 24)");
    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    vi.useRealTimers();
  });

  it("reorders thumbnails visually", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    drag(handle(container, 0), card(container, 1));
    await flush();

    expect(cardLabels(container)).toEqual(["Page 1", "Page 2"]);
    expect(liveText(container)).toBe("Reorder page complete");
  });

  it("uses grab and grabbing cursor states while dragging thumbnails", async () => {
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
    mockPageCount = 20;
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
    mockPageCount = 20;
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
    const lens = new AuroraLens(container, { allowEdit: true, decoder: new DecoderMock(), sessionStore: store });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
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
      decoder: new DecoderMock(),
      onStateChange: (state) => states.push(state),
    });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);

    await lens.goToPage(1);

    expect(states.at(-1)).toMatchObject({
      viewMode: "page",
      pageIndex: 1,
      pageWidth: 101,
      pageHeight: 201,
    });
  });
});

function rasterPage(sourceName: string, pageIndex: number, width: number, height: number, pageCount = mockPageCount): RasterPage {
  return {
    sourceName,
    pageIndex,
    pageNumber: pageIndex + 1,
    pageCount,
    width,
    height,
    pixels: new Uint8ClampedArray(width * height * 4),
  };
}

function metadata() {
  return {
    pages: [
      {
        pageNumber: 1,
        width: 100,
        height: 200,
        tokens: [
          {
            content: "Alpha",
            confidence: 0.98,
            polygon: [10, 10, 40, 10, 40, 30, 10, 30],
          },
        ],
        contexts: [
          {
            content: "Alpha Beta",
            role: "body",
            polygon: [5, 5, 75, 5, 75, 35, 5, 35],
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
  return Array.from(container.querySelectorAll("[aria-label^='Intelligence ready for page']")).map((element) => element.getAttribute("aria-label") ?? "");
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
  validationConfig: PageSizeConfig | null = null;

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

  async readPageValidationConfig() {
    return this.validationConfig ?? {
      formats: [
        { name: "letter", width: 8.5, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
    };
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

  async readPageBlob(pageId: string) {
    return this.blobs.find((record) => record.pageId === pageId)?.blob ?? null;
  }

  async savePageMetadata(record: ViewerPageMetadataRecord) {
    this.metadata.push(record);
  }

  async savePageValidationConfig(config: PageSizeConfig) {
    this.validationConfig = config;
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

  async saveCurrentPage(_pageId: string, _updatedAt: number) {}

  async savePageBlob(_record: ViewerPageBlobRecord) {}

  async readPageBlob(_pageId: string) {
    return null;
  }

  async savePageMetadata(_record: ViewerPageMetadataRecord) {}

  async readPageValidationConfig() {
    return {
      formats: [
        { name: "letter", width: 8.5, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
    };
  }

  async savePageValidationConfig(config: PageSizeConfig) {
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
