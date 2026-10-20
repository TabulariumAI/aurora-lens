import type { RasterConfig } from "../config/viewerConfig";
import { LENS_ERROR_RASTER_LIMIT, LENS_ERROR_UNREADABLE_DOCUMENT, LensError } from "../errors/LensError";

export interface RasterImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

export async function readRasterImage(blob: Blob, limits?: RasterConfig): Promise<RasterImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (limits && (width > limits.maxRasterWidth || height > limits.maxRasterHeight || width * height > limits.maxRasterPixels)) {
      throw new LensError(LENS_ERROR_RASTER_LIMIT, "Raster page exceeds the configured raster limits.");
    }
    const canvas = new OffscreenCanvas(width, height);
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "Raster decoder canvas is unavailable.");
      context.drawImage(bitmap, 0, 0);
      return { width, height, pixels: context.getImageData(0, 0, width, height).data };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
