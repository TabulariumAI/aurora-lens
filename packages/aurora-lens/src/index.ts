export { AuroraLens } from "./core/AuroraLens";
export {
  LENS_ERROR_EMPTY_DOCUMENT,
  LENS_ERROR_PAGE_OUT_OF_RANGE,
  LENS_ERROR_PAGE_SIZE,
  LENS_ERROR_RASTER_LIMIT,
  LENS_ERROR_UNSUPPORTED_FORMAT,
  LENS_ERROR_UNKNOWN,
  LENS_ERROR_UNREADABLE_DOCUMENT,
  LensError,
  isLensError,
} from "./core/errors/LensError";
export { DocumentDecoder } from "./core/decoder/DocumentDecoder";
export { detectDocType } from "./core/decoder/detect";
export {
  DOC_TYPE_JPEG,
  DOC_TYPE_PDF,
  DOC_TYPE_PNG,
  DOC_TYPE_TIFF,
} from "./core/decoder/types";
export {
  DEFAULT_PDF_RASTER_DPI,
  configurePdfWorker,
  decodePdfBytes,
  decodePdfFile,
} from "./core/decoder/PdfPageDecoder";
export {
  DEFAULT_PAGE_FORMATS,
  DEFAULT_PAGE_TOLERANCE,
  validateRasterPageSize,
} from "./core/validation/pageSizeValidation";
export {
  ACTIVE_VIEWER_SESSION_ID,
  IndexedDbViewerSessionStore,
  VIEWER_DOCUMENT_STORE_NAME,
  VIEWER_CONFIG_STORE_NAME,
  VIEWER_PAGE_BLOB_STORE_NAME,
  VIEWER_PAGE_METADATA_STORE_NAME,
  VIEWER_PAGE_STORE_NAME,
  VIEWER_SESSION_DB_NAME,
  VIEWER_SESSION_DB_VERSION,
  validateViewerSession,
} from "./core/session/viewerSessionStore";
export {
  DEFAULT_EXPORT_CONFIG,
  DEFAULT_TIFF_EXPORT,
  DEFAULT_VIEW_RASTER,
  TIFF_PIXEL_FORMAT_BW1,
  TIFF_PIXEL_FORMAT_GRAY8,
  TIFF_PIXEL_FORMAT_RGB24,
  defaultViewerConfig,
} from "./core/config/viewerConfig";
export type {
  LensErrorCode,
} from "./core/errors/LensError";
export type {
  ViewerOptions,
  ViewerReady,
  ViewerState,
  ViewerStatus,
  ViewMode,
  CopySelectionResult,
  MetadataIndex,
  PageContext,
  PageFigure,
  PageInfo,
  PageMetadataHits,
  PagePoint,
  PageRect,
  PageToken,
  PartialSelectionTheme,
  SelectedGroup,
  SelectionColor,
  SelectionCounts,
  SelectionTheme,
  RasterPage,
  ViewerSession,
  ViewerSessionStore,
} from "./core/types";
export type {
  DecodedPage as DecodedDocPage,
  DecodeSink,
  DocType,
} from "./core/decoder/types";
export type {
  PdfDecodeOptions,
  PdfRasterPage,
} from "./core/decoder/PdfPageDecoder";
export type {
  PageFormat,
  PageSizeConfig,
  PageSizeInput,
  PageSizeResult,
} from "./core/validation/pageSizeValidation";
export type {
  ExportConfig,
  RasterConfig,
  TiffExportConfig,
  TiffPixelFormat,
  ViewerConfig,
} from "./core/config/viewerConfig";
