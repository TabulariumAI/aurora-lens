import {
  DECODER_ERROR_UNKNOWN,
  DECODER_ERROR_UNREADABLE_DOCUMENT,
  DecoderError,
  type DecoderErrorCode,
} from "../../DecoderError";
import { DOC_TYPE_JPEG, DOC_TYPE_PNG } from "../types";
import type { DecodeRequest, DecodeResponse, DecodedPage, DocType } from "../types";

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  void decode(event.data).catch((reason: unknown) => {
    workerScope.postMessage({
      id: event.data.id,
      kind: "error",
      errorCode: errorCode(reason),
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
};

async function decode(request: DecodeRequest): Promise<void> {
  post({ id: request.id, kind: "pageCount", pageCount: request.files.length });
  if (request.operation === "count") {
    post({ id: request.id, kind: "done" });
    return;
  }

  for (let importIndex = 0; importIndex < request.files.length; importIndex += 1) {
    const file = request.files[importIndex];
    const bytes = new Uint8Array(file.buffer);
    const blob = new Blob([bytes]);
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new DecoderError(DECODER_ERROR_UNREADABLE_DOCUMENT, "Raster decoder canvas is unavailable.");
    }
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const dpi = readDpi(file.sourceType, bytes);
    const page: DecodedPage = {
      sourceName: file.sourceName,
      sourceType: file.sourceType,
      pageIndex: 0,
      pageNumber: 1,
      pageCount: 1,
      width: bitmap.width,
      height: bitmap.height,
      pixels: new Uint8ClampedArray(imageData.data),
      xResolution: dpi.xResolution,
      yResolution: dpi.yResolution,
    };
    post({ id: request.id, kind: "pageReady", importIndex, page }, [page.pixels.buffer]);
  }

  post({ id: request.id, kind: "done" });
}

function readDpi(type: DocType, bytes: Uint8Array) {
  if (type === DOC_TYPE_PNG) {
    return readPngDpi(bytes);
  }
  if (type === DOC_TYPE_JPEG) {
    return readJpegDpi(bytes);
  }
  return { xResolution: 0, yResolution: 0 };
}

function readPngDpi(bytes: Uint8Array) {
  let offset = 8;
  while (offset + 17 <= bytes.length) {
    const length = (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === "pHYs") {
      const xppm = (
        (bytes[offset + 8] << 24) |
        (bytes[offset + 9] << 16) |
        (bytes[offset + 10] << 8) |
        bytes[offset + 11]
      ) >>> 0;
      const yppm = (
        (bytes[offset + 12] << 24) |
        (bytes[offset + 13] << 16) |
        (bytes[offset + 14] << 8) |
        bytes[offset + 15]
      ) >>> 0;
      if (bytes[offset + 16] === 1) {
        return {
          xResolution: xppm * 0.0254,
          yResolution: yppm * 0.0254,
        };
      }
    }
    offset += 12 + length;
  }
  return { xResolution: 0, yResolution: 0 };
}

function readJpegDpi(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 16 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe0) {
      const id = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7], bytes[offset + 8]);
      if (id === "JFIF\0") {
        const unit = bytes[offset + 11];
        const xDensity = (bytes[offset + 12] << 8) | bytes[offset + 13];
        const yDensity = (bytes[offset + 14] << 8) | bytes[offset + 15];
        if (unit === 1) {
          return {
            xResolution: xDensity,
            yResolution: yDensity,
          };
        }
        if (unit === 2) {
          return {
            xResolution: xDensity * 2.54,
            yResolution: yDensity * 2.54,
          };
        }
      }
    }
    offset += 2 + length;
  }
  return { xResolution: 0, yResolution: 0 };
}

function post(response: DecodeResponse, transfer?: Transferable[]) {
  workerScope.postMessage(response, transfer);
}

function errorCode(error: unknown): DecoderErrorCode {
  return error instanceof DecoderError ? error.code : DECODER_ERROR_UNKNOWN;
}
