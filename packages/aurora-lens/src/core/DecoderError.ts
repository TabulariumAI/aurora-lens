export const DECODER_ERROR_UNREADABLE_DOCUMENT = "unreadable_document";
export const DECODER_ERROR_PAGE_OUT_OF_RANGE = "page_out_of_range";
export const DECODER_ERROR_EMPTY_DOCUMENT = "empty_document";
export const DECODER_ERROR_PAGE_SIZE = "page_size";
export const DECODER_ERROR_UNKNOWN = "unknown";

export type DecoderErrorCode =
  | typeof DECODER_ERROR_UNREADABLE_DOCUMENT
  | typeof DECODER_ERROR_PAGE_OUT_OF_RANGE
  | typeof DECODER_ERROR_EMPTY_DOCUMENT
  | typeof DECODER_ERROR_PAGE_SIZE
  | typeof DECODER_ERROR_UNKNOWN;

export class DecoderError extends Error {
  constructor(readonly code: DecoderErrorCode, message: string) {
    super(message);
    this.name = "DecoderError";
  }
}

export function isDecoderError(error: unknown): error is DecoderError {
  return error instanceof DecoderError;
}
