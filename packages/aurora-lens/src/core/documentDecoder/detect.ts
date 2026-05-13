import {
  DECODER_ERROR_UNSUPPORTED_FORMAT,
  DecoderError,
} from "../DecoderError";
import {
  DOC_TYPE_JPEG,
  DOC_TYPE_PDF,
  DOC_TYPE_PNG,
  DOC_TYPE_TIFF,
  type DocType,
} from "./types";

const MIME_TYPES: Record<string, DocType> = {
  "application/pdf": DOC_TYPE_PDF,
  "image/jpeg": DOC_TYPE_JPEG,
  "image/png": DOC_TYPE_PNG,
  "image/tiff": DOC_TYPE_TIFF,
};

export function detectDocType(bytes: Uint8Array, file: File): DocType {
  if (isTiff(bytes)) {
    return DOC_TYPE_TIFF;
  }
  if (isPdf(bytes)) {
    return DOC_TYPE_PDF;
  }
  if (isPng(bytes)) {
    return DOC_TYPE_PNG;
  }
  if (isJpeg(bytes)) {
    return DOC_TYPE_JPEG;
  }

  const mimeType = MIME_TYPES[file.type.toLowerCase()];
  if (mimeType) {
    return mimeType;
  }

  const name = file.name.toLowerCase();
  if (/\.tiff?$/.test(name)) {
    return DOC_TYPE_TIFF;
  }
  if (/\.pdf$/.test(name)) {
    return DOC_TYPE_PDF;
  }
  if (/\.png$/.test(name)) {
    return DOC_TYPE_PNG;
  }
  if (/\.jpe?g$/.test(name)) {
    return DOC_TYPE_JPEG;
  }

  throw new DecoderError(DECODER_ERROR_UNSUPPORTED_FORMAT, "Unsupported document format.");
}

function isTiff(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
    )
  );
}

function isPdf(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function isPng(bytes: Uint8Array) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
