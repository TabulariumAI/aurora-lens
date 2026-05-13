export { AuroraLens } from "./core/AuroraLens";
export {
  DECODER_ERROR_EMPTY_DOCUMENT,
  DECODER_ERROR_PAGE_OUT_OF_RANGE,
  DECODER_ERROR_PAGE_SIZE,
  DECODER_ERROR_RASTER_LIMIT,
  DECODER_ERROR_UNSUPPORTED_FORMAT,
  DECODER_ERROR_UNKNOWN,
  DECODER_ERROR_UNREADABLE_DOCUMENT,
  DecoderError,
  isDecoderError,
} from "./core/DecoderError";
export { DocumentDecoder } from "./core/documentDecoder/DocumentDecoder";
export { detectDocType } from "./core/documentDecoder/detect";
export {
  DOC_TYPE_JPEG,
  DOC_TYPE_PDF,
  DOC_TYPE_PNG,
  DOC_TYPE_TIFF,
} from "./core/documentDecoder/types";
export {
  DEFAULT_PDF_RASTER_DPI,
  configurePdfWorker,
  decodePdfBytes,
  decodePdfFile,
} from "./core/PdfPageDecoder";
export {
  DEFAULT_PAGE_FORMATS,
  DEFAULT_PAGE_TOLERANCE,
  validateRasterPageSize,
} from "./core/pageSizeValidation";
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
} from "./core/viewerSessionStore";
export {
  DEFAULT_EXPORT_RASTER,
  DEFAULT_VIEW_RASTER,
  defaultViewerConfig,
} from "./core/viewerConfig";
export type {
  DecoderErrorCode,
} from "./core/DecoderError";
export type {
  ViewerOptions,
  ViewerReady,
  ViewerState,
  ViewerStatus,
  ViewMode,
  CopySelectionResult,
  PageContext,
  PageFigure,
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
} from "./core/documentDecoder/types";
export type {
  PdfDecodeOptions,
  PdfRasterPage,
} from "./core/PdfPageDecoder";
export type {
  PageFormat,
  PageSizeConfig,
  PageSizeInput,
  PageSizeResult,
} from "./core/pageSizeValidation";
export type {
  RasterConfig,
  ViewerConfig,
} from "./core/viewerConfig";
