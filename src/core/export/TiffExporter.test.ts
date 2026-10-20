import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LENS_ERROR_RASTER_LIMIT } from "../errors/LensError";
import { TIFF_PIXEL_FORMAT_RGB24, type ExportConfig } from "../config/viewerConfig";
import type { ViewerPageBlobRecord } from "../session/viewerSessionStore";

const tiffMock = vi.hoisted(() => ({
  module: {
    HEAPU8: new Uint8Array(1024),
    _TiffWriterCreate: vi.fn(() => 1),
    _malloc: vi.fn(() => 16),
    _TiffWriterAddRGBA: vi.fn(() => 1),
    _free: vi.fn(),
    _TiffWriterFinish: vi.fn((writer: number, sizePointer: number) => {
      tiffMock.module.HEAPU8[sizePointer] = 3;
      tiffMock.module.HEAPU8[sizePointer + 1] = 0;
      tiffMock.module.HEAPU8[sizePointer + 2] = 0;
      tiffMock.module.HEAPU8[sizePointer + 3] = 0;
      tiffMock.module.HEAPU8.set([1, 2, 3], 128);
      return 128;
    }),
    _TiffFreeMemory: vi.fn(),
    _TiffWriterDestroy: vi.fn(),
  },
}));

vi.mock("../decoder/vendor/auroraTiff.js", () => ({
  default: vi.fn(() => Promise.resolve(tiffMock.module)),
}));

const { exportTiffPages } = await import("./workers/tiffExportWorker");

const config: ExportConfig = {
  pdfRasterDpi: 300,
  maxRasterPixels: 1_000_000,
  maxRasterWidth: 1000,
  maxRasterHeight: 1000,
  tiff: {
    compression: 5,
    pixelFormat: TIFF_PIXEL_FORMAT_RGB24,
  },
};

const page: ViewerPageBlobRecord = {
  pageId: "page-1",
  blob: new Blob(["page"], { type: "image/png" }),
  width: 10,
  height: 10,
  xResolution: 300,
  yResolution: 300,
};

describe("TiffExporter", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve({
      width: 10,
      height: 10,
      close: vi.fn(),
    })));
    vi.stubGlobal("ImageData", class ImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    });
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext = vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
        putImageData: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      }));
    });
  });

  it("exports stored page blobs through the TIFF writer", async () => {
    const blob = await exportTiffPages([page], config);

    expect(blob.type).toBe("image/tiff");
    expect(await blob.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(tiffMock.module._TiffWriterCreate).toHaveBeenCalledWith(5);
    expect(tiffMock.module._TiffWriterAddRGBA).toHaveBeenCalledWith(1, 16, 10, 10, 5, 24, 2, 300, 300);
    expect(tiffMock.module._TiffWriterDestroy).toHaveBeenCalledWith(1);
  });

  it("rejects export rasters that exceed configured limits", async () => {
    await expect(exportTiffPages([page], {
      ...config,
      maxRasterWidth: 5,
    })).rejects.toMatchObject({
      code: LENS_ERROR_RASTER_LIMIT,
    });
  });

  it("reports completed pages in order and finalizes only after encoding", async () => {
    const progress = vi.fn();
    tiffMock.module._TiffWriterFinish.mockImplementationOnce((_writer, pointer) => {
      expect(progress).toHaveBeenLastCalledWith({ phase: "finalizing", completed: 2, total: 2 });
      tiffMock.module.HEAPU8.set([3, 0, 0, 0], pointer);
      tiffMock.module.HEAPU8.set([1, 2, 3], 128);
      return 128;
    });
    await exportTiffPages([page, { ...page, pageId: "page-2" }], config, progress);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { phase: "pages", completed: 0, total: 2 },
      { phase: "pages", completed: 1, total: 2 },
      { phase: "pages", completed: 2, total: 2 },
      { phase: "finalizing", completed: 2, total: 2 },
    ]);
    expect(tiffMock.module._TiffWriterAddRGBA.mock.invocationCallOrder[0]).toBeLessThan(progress.mock.invocationCallOrder[1]);
    expect(tiffMock.module._TiffWriterAddRGBA.mock.invocationCallOrder[1]).toBeLessThan(progress.mock.invocationCallOrder[2]);
    for (const result of vi.mocked(createImageBitmap).mock.results) {
      expect((await result.value).close).toHaveBeenCalledTimes(1);
    }
  });

  it("does not report a failed page as prepared and releases writer memory", async () => {
    tiffMock.module._TiffWriterAddRGBA.mockReturnValueOnce(0);
    const progress = vi.fn();
    await expect(exportTiffPages([page], config, progress)).rejects.toThrow("Failed to write page page-1.");
    expect(progress.mock.calls.map(([value]) => value)).toEqual([{ phase: "pages", completed: 0, total: 1 }]);
    expect(tiffMock.module._free).toHaveBeenCalledWith(16);
    expect(tiffMock.module._TiffWriterDestroy).toHaveBeenCalledWith(1);
    expect(tiffMock.module._TiffWriterFinish).not.toHaveBeenCalled();
  });

  it("preserves raster scaling, compression, resolution and pixel format", async () => {
    await exportTiffPages([page], { ...config, pdfRasterDpi: 150, tiff: { compression: 8, pixelFormat: "gray8" } });
    expect(tiffMock.module._TiffWriterAddRGBA).toHaveBeenCalledWith(1, 16, 5, 5, 8, 8, 2, 150, 150);
  });

  it("reports finalization failure without returning a TIFF", async () => {
    tiffMock.module._TiffWriterFinish.mockReturnValueOnce(0);
    await expect(exportTiffPages([page], config)).rejects.toThrow("Failed to finish TIFF export.");
    expect(tiffMock.module._TiffWriterDestroy).toHaveBeenCalledWith(1);
  });

  it("sends worker progress followed by the completed TIFF", async () => {
    const post = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    self.onmessage!(new MessageEvent("message", { data: { pages: [page], config } }));
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith({ kind: "done", blob: expect.any(Blob) }));
    expect(post.mock.calls.map(([value]) => value.kind)).toEqual(["progress", "progress", "progress", "done"]);
  });

  it("preserves the worker error code and never sends done after failure", async () => {
    const post = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
    self.onmessage!(new MessageEvent("message", { data: { pages: [page], config: { ...config, maxRasterWidth: 5 } } }));
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith({ kind: "error", errorCode: "raster_limit", error: "TIFF export exceeds configured raster limits." }));
    expect(post.mock.calls.some(([value]) => value.kind === "done")).toBe(false);
  });
});
