import { DEFAULT_PAGE_FORMATS, DEFAULT_PAGE_TOLERANCE, type PageFormat } from "./pageSizeValidation";

export interface RasterConfig {
  pdfRasterDpi: number;
  maxRasterPixels: number;
  maxRasterWidth: number;
  maxRasterHeight: number;
}

export interface ViewerConfig {
  formats: PageFormat[];
  tolerance: number;
  view: RasterConfig;
  export: RasterConfig;
}

export const DEFAULT_VIEW_RASTER: RasterConfig = {
  pdfRasterDpi: 150,
  maxRasterPixels: 40_000_000,
  maxRasterWidth: 10_000,
  maxRasterHeight: 10_000,
};

export const DEFAULT_EXPORT_RASTER: RasterConfig = {
  pdfRasterDpi: 300,
  maxRasterPixels: 160_000_000,
  maxRasterWidth: 20_000,
  maxRasterHeight: 20_000,
};

export function defaultViewerConfig(): ViewerConfig {
  return {
    formats: DEFAULT_PAGE_FORMATS.map((format) => ({ ...format })),
    tolerance: DEFAULT_PAGE_TOLERANCE,
    view: { ...DEFAULT_VIEW_RASTER },
    export: { ...DEFAULT_EXPORT_RASTER },
  };
}
