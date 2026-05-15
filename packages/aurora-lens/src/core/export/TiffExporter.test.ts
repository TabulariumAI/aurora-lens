import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { exportTiffPages } = await import("./TiffExporter");

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
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
        putImageData: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      })),
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
});
