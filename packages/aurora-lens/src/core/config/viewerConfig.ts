import { DEFAULT_PAGE_FORMATS, DEFAULT_PAGE_TOLERANCE, type PageFormat } from "../validation/pageSizeValidation";

export const TIFF_PIXEL_FORMAT_BW1 = "bw1";
export const TIFF_PIXEL_FORMAT_GRAY8 = "gray8";
export const TIFF_PIXEL_FORMAT_RGB24 = "rgb24";

export type TiffPixelFormat =
  | typeof TIFF_PIXEL_FORMAT_BW1
  | typeof TIFF_PIXEL_FORMAT_GRAY8
  | typeof TIFF_PIXEL_FORMAT_RGB24;

export interface RasterConfig {
  pdfRasterDpi: number;
  maxRasterPixels: number;
  maxRasterWidth: number;
  maxRasterHeight: number;
}

export interface TiffExportConfig {
  compression: number;
  pixelFormat: TiffPixelFormat;
}

export interface ExportConfig extends RasterConfig {
  tiff: TiffExportConfig;
}

export interface ViewerConfig {
  formats: PageFormat[];
  tolerance: number;
  view: RasterConfig;
  export: ExportConfig;
}

export const DEFAULT_VIEW_RASTER: RasterConfig = {
  pdfRasterDpi: 150,
  maxRasterPixels: 40_000_000,
  maxRasterWidth: 10_000,
  maxRasterHeight: 10_000,
};

export const DEFAULT_TIFF_EXPORT: TiffExportConfig = {
  compression: 5,
  pixelFormat: TIFF_PIXEL_FORMAT_RGB24,
};

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  pdfRasterDpi: 300,
  maxRasterPixels: 160_000_000,
  maxRasterWidth: 20_000,
  maxRasterHeight: 20_000,
  tiff: { ...DEFAULT_TIFF_EXPORT },
};

export function defaultViewerConfig(): ViewerConfig {
  return {
    formats: DEFAULT_PAGE_FORMATS.map((format) => ({ ...format })),
    tolerance: DEFAULT_PAGE_TOLERANCE,
    view: { ...DEFAULT_VIEW_RASTER },
    export: {
      ...DEFAULT_EXPORT_CONFIG,
      tiff: { ...DEFAULT_EXPORT_CONFIG.tiff },
    },
  };
}
