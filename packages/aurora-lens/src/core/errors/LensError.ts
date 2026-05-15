export const LENS_ERROR_UNREADABLE_DOCUMENT = "unreadable_document";
export const LENS_ERROR_PAGE_OUT_OF_RANGE = "page_out_of_range";
export const LENS_ERROR_EMPTY_DOCUMENT = "empty_document";
export const LENS_ERROR_PAGE_SIZE = "page_size";
export const LENS_ERROR_RASTER_LIMIT = "raster_limit";
export const LENS_ERROR_UNSUPPORTED_FORMAT = "unsupported_format";
export const LENS_ERROR_UNKNOWN = "unknown";

export type LensErrorCode =
  | typeof LENS_ERROR_UNREADABLE_DOCUMENT
  | typeof LENS_ERROR_PAGE_OUT_OF_RANGE
  | typeof LENS_ERROR_EMPTY_DOCUMENT
  | typeof LENS_ERROR_PAGE_SIZE
  | typeof LENS_ERROR_RASTER_LIMIT
  | typeof LENS_ERROR_UNSUPPORTED_FORMAT
  | typeof LENS_ERROR_UNKNOWN;

export class LensError extends Error {
  constructor(readonly code: LensErrorCode, message: string) {
    super(message);
    this.name = "LensError";
  }
}

export function isLensError(error: unknown): error is LensError {
  return error instanceof LensError;
}
