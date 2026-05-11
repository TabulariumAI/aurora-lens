import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuroraLens } from "./AuroraLens";
import type { ViewerDecoder, ViewerState, ViewerStatus, RasterPage } from "./types";

let mockPageCount = 2;
let decoderMessages: Array<{ kind: "page" | "thumbnail"; pageIndex: number }> = [];

class DecoderMock implements ViewerDecoder {
  async decode(file: File, pageIndex: number) {
    decoderMessages.push({ kind: "page", pageIndex });
    return rasterPage(file.name, pageIndex, 100 + pageIndex, 200 + pageIndex);
  }

  async thumbnail(file: File, pageIndex: number) {
    decoderMessages.push({ kind: "thumbnail", pageIndex });
    return rasterPage(file.name, pageIndex, 32, 48);
  }
}

describe("AuroraLens", () => {
  beforeEach(() => {
    mockPageCount = 2;
    decoderMessages = [];
    vi.stubGlobal("ImageData", class ImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
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

  it("copies selected tokens in grouped JSON shape", async () => {
    const lens = new AuroraLens(document.createElement("div"), { decoder: new DecoderMock() });
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

  it("reports thumbnail selection without opening the page internally", async () => {
    const states: ViewerState[] = [];
    const container = document.createElement("div");
    const selected: number[] = [];
    const lens = new AuroraLens(container, {
      decoder: new DecoderMock(),
      onStateChange: (state) => states.push(state),
      onThumbnailSelect: (pageIndex) => selected.push(pageIndex),
    });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);
    await lens.showThumbnails();

    const pageTwo = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Page 2"));
    pageTwo?.click();

    expect(selected).toEqual([1]);
    expect(states.at(-1)).toMatchObject({
      viewMode: "thumbnails",
      pageIndex: 0,
    });
  });

  it("shows thumbnail placeholders before decoding the bounded range", async () => {
    mockPageCount = 30;
    const container = document.createElement("div");
    const lens = new AuroraLens(container, { decoder: new DecoderMock() });
    lens.loadMetadata(metadata());
    await lens.decodeTiff(new File(["raster"], "sample.raster"), 0);

    await lens.showThumbnails();

    const placeholders = container.querySelectorAll("[aria-label$='thumbnail loading']");
    expect(container.querySelectorAll("button")).toHaveLength(30);
    expect(placeholders).toHaveLength(30);
    expect(placeholders[0].getAttribute("style")).toContain("aspect-ratio");
    expect(placeholders[0].querySelectorAll("span[aria-hidden='true']")).toHaveLength(1);
    expect((placeholders[0].querySelector("span[aria-hidden='true']") as HTMLElement).style.animation).toContain("aurora-lens-thumbnail-sheen");
    expect(decoderMessages.filter((message) => message.kind === "thumbnail")).toHaveLength(0);

    await new Promise((resolve) => window.setTimeout(resolve, 10));

    const thumbnails = decoderMessages.filter((message) => message.kind === "thumbnail");
    expect(thumbnails.length).toBeGreaterThan(0);
    expect(thumbnails.length).toBeLessThan(30);
    expect(container.querySelectorAll("button img")).toHaveLength(20);
  });

  it("opens a selected page through the public page API", async () => {
    const states: ViewerState[] = [];
    const lens = new AuroraLens(document.createElement("div"), {
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

function rasterPage(sourceName: string, pageIndex: number, width: number, height: number): RasterPage {
  return {
    sourceName,
    pageIndex,
    pageNumber: pageIndex + 1,
    pageCount: mockPageCount,
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
