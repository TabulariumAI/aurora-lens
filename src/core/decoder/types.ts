import type { LensErrorCode } from "../errors/LensError";
import type { RasterConfig } from "../config/viewerConfig";

export const DOC_TYPE_TIFF = "tiff";
export const DOC_TYPE_PDF = "pdf";
export const DOC_TYPE_PNG = "png";
export const DOC_TYPE_JPEG = "jpeg";

export type DocType =
  | typeof DOC_TYPE_TIFF
  | typeof DOC_TYPE_PDF
  | typeof DOC_TYPE_PNG
  | typeof DOC_TYPE_JPEG;

export interface DecodedPage {
  sourceName: string;
  sourceType: DocType;
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  xResolution: number;
  yResolution: number;
}

export type PdfRasterPage = Omit<DecodedPage, "sourceType">;

export interface DecodeSink {
  pageCount(count: number, sourceType?: DocType): Promise<void> | void;
  pageReady(page: DecodedPage, importIndex: number): Promise<void> | void;
}

export type DecodeResponse =
  | {
    id: number;
    kind: "pageCount";
    pageCount: number;
  }
  | {
    id: number;
    kind: "pageReady";
    importIndex: number;
    page: DecodedPage;
  }
  | {
    id: number;
    kind: "done";
  }
  | {
    id: number;
    kind: "error";
    errorCode: LensErrorCode;
    error: string;
  };

export interface DecodeFile {
  buffer: ArrayBuffer;
  sourceName: string;
  sourceType: DocType;
}

export interface DecodeRequest {
  id: number;
  operation: "count" | "decode";
  raster: RasterConfig;
  files: DecodeFile[];
}

export type TiffRequest = DecodeRequest
  | { id: number; operation: "open"; files: DecodeFile[]; raster: RasterConfig }
  | { id: number; operation: "page"; documentId: number; pageIndex: number; raster: RasterConfig }
  | { operation: "release"; documentId: number }
  | { id: number; operation: "continue" }
  | { id: number; operation: "cancel" };
