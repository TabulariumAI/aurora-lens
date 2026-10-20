import { readPdfDocument } from "../pdfDocument";
import { LENS_ERROR_UNKNOWN, LensError } from "../../errors/LensError";
import type { DecodeRequest, DecodeResponse } from "../types";

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data: request }) => {
  void decode(request).catch((error: unknown) => {
    scope.postMessage({
      id: request.id, kind: "error",
      errorCode: error instanceof LensError ? error.code : LENS_ERROR_UNKNOWN,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

async function decode(request: DecodeRequest) {
  let count = 0;
  let importIndex = 0;
  for (const file of request.files) {
    await readPdfDocument(new Uint8Array(file.buffer), file.sourceName, request.raster, {
      pageCount(value) { count += value; },
      pageReady: request.operation === "count" ? undefined : page => {
        const decoded = { ...page, sourceType: file.sourceType };
        scope.postMessage({ id: request.id, kind: "pageReady", importIndex: importIndex++, page: decoded }, [page.pixels.buffer]);
      },
    });
  }
  scope.postMessage({ id: request.id, kind: "pageCount", pageCount: count });
  scope.postMessage({ id: request.id, kind: "done" });
}
