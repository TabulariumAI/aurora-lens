import { readRasterImage, type RasterImage } from "../../decoder/rasterImage";
import {
  LENS_ERROR_RASTER_LIMIT,
  LENS_ERROR_UNKNOWN,
  LENS_ERROR_UNREADABLE_DOCUMENT,
  LensError,
} from "../../errors/LensError";
import createAuroraTiffModule from "../../decoder/vendor/auroraTiff.js";
import type { AuroraTiffModule } from "../../decoder/vendor/auroraTiff";
import {
  TIFF_PIXEL_FORMAT_BW1,
  TIFF_PIXEL_FORMAT_GRAY8,
  TIFF_PIXEL_FORMAT_RGB24,
  type ExportConfig,
  type TiffPixelFormat,
} from "../../config/viewerConfig";
import type { ExportProgress, ExportRequest, ExportResponse } from "../types";
import type { ViewerPageBlobRecord } from "../../session/viewerSessionStore";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null;
  postMessage(message: ExportResponse): void;
}

const workerScope = self as unknown as WorkerScope;
workerScope.onmessage = (event) => {
  void exportTiffPages(event.data.pages, event.data.config, (progress) => {
    workerScope.postMessage({ kind: "progress", progress });
  }).then((blob) => {
    workerScope.postMessage({ kind: "done", blob });
  }).catch((error: unknown) => {
    workerScope.postMessage({
      kind: "error",
      errorCode: error instanceof LensError ? error.code : LENS_ERROR_UNKNOWN,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

const RGBA_CHANNELS = 4;
const RESOLUTION_INCH = 2;
const TIFF_MIME_TYPE = "image/tiff";
const PIXEL_FORMATS: Record<TiffPixelFormat, number> = {
  [TIFF_PIXEL_FORMAT_BW1]: 1,
  [TIFF_PIXEL_FORMAT_GRAY8]: 8,
  [TIFF_PIXEL_FORMAT_RGB24]: 24,
};

let modulePromise: Promise<AuroraTiffModule> | null = null;

export async function exportTiffPages(pages: ViewerPageBlobRecord[], config: ExportConfig, onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
  const module = await getModule();
  const pixelFormat = PIXEL_FORMATS[config.tiff.pixelFormat];
  const writer = module._TiffWriterCreate(config.tiff.compression);
  if (!writer) {
    throw new LensError(LENS_ERROR_UNKNOWN, "Failed to create TIFF writer.");
  }

  try {
    onProgress?.({ phase: "pages", completed: 0, total: pages.length });
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const image = await exportImage(page, config);
      const byteLength = image.width * image.height * RGBA_CHANNELS;
      const pointer = allocate(module, byteLength);
      try {
        module.HEAPU8.set(image.pixels, pointer);
        const ok = module._TiffWriterAddRGBA(
          writer,
          pointer,
          image.width,
          image.height,
          config.tiff.compression,
          pixelFormat,
          RESOLUTION_INCH,
          config.pdfRasterDpi,
          config.pdfRasterDpi
        );
        if (ok !== 1) {
          throw new LensError(LENS_ERROR_UNKNOWN, `Failed to write page ${page.pageId}.`);
        }
      } finally {
        module._free(pointer);
      }
      onProgress?.({ phase: "pages", completed: index + 1, total: pages.length });
    }
    onProgress?.({ phase: "finalizing", completed: pages.length, total: pages.length });
    return new Blob([finishTiff(module, writer)], { type: TIFF_MIME_TYPE });
  } finally {
    module._TiffWriterDestroy(writer);
  }
}

async function exportImage(page: ViewerPageBlobRecord, config: ExportConfig): Promise<RasterImage> {
  const image = await readRasterImage(page.blob);
  const width = Math.round(image.width * config.pdfRasterDpi / page.xResolution);
  const height = Math.round(image.height * config.pdfRasterDpi / page.yResolution);
  validateSize(width, height, config);
  if (width === image.width && height === image.height) {
    return image;
  }
  return scaleImage(image, width, height);
}

function scaleImage(image: RasterImage, width: number, height: number): RasterImage {
  const sourceCanvas = new OffscreenCanvas(image.width, image.height);
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "TIFF export canvas is unavailable.");
  }
  sourceContext.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "TIFF export canvas is unavailable.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, width, height);
  return {
    width,
    height,
    pixels: context.getImageData(0, 0, width, height).data,
  };
}

function validateSize(width: number, height: number, config: ExportConfig): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > config.maxRasterWidth ||
    height > config.maxRasterHeight ||
    width * height > config.maxRasterPixels
  ) {
    throw new LensError(LENS_ERROR_RASTER_LIMIT, "TIFF export exceeds configured raster limits.");
  }
}

function finishTiff(module: AuroraTiffModule, writer: number): Uint8Array<ArrayBuffer> {
  const sizePointer = allocate(module, 4);
  try {
    const pointer = module._TiffWriterFinish(writer, sizePointer);
    const size =
      module.HEAPU8[sizePointer] |
      (module.HEAPU8[sizePointer + 1] << 8) |
      (module.HEAPU8[sizePointer + 2] << 16) |
      (module.HEAPU8[sizePointer + 3] << 24);
    if (!pointer || size <= 0) {
      throw new LensError(LENS_ERROR_UNKNOWN, "Failed to finish TIFF export.");
    }
    const result = module.HEAPU8.slice(pointer, pointer + size);
    module._TiffFreeMemory(pointer);
    return result;
  } finally {
    module._free(sizePointer);
  }
}

function allocate(module: AuroraTiffModule, byteLength: number): number {
  const pointer = module._malloc(byteLength);
  if (!pointer) {
    throw new LensError(LENS_ERROR_UNKNOWN, "AuroraTiff could not allocate export memory.");
  }
  return pointer;
}

function getModule(): Promise<AuroraTiffModule> {
  modulePromise ??= createAuroraTiffModule();
  return modulePromise;
}
