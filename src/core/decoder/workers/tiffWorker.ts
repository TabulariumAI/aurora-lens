import {
  LENS_ERROR_EMPTY_DOCUMENT,
  LENS_ERROR_PAGE_OUT_OF_RANGE,
  LENS_ERROR_RASTER_LIMIT,
  LENS_ERROR_UNKNOWN,
  LENS_ERROR_UNREADABLE_DOCUMENT,
  LensError,
  type LensErrorCode,
} from "../../errors/LensError";
import type { DecodeFile, DecodeRequest, DecodeResponse, DecodedPage, TiffRequest } from "../types";
import type { RasterConfig } from "../../config/viewerConfig";
import createAuroraTiffModule from "../vendor/auroraTiff.js";
import type { AuroraTiffModule } from "../vendor/auroraTiff";

const RGBA_CHANNELS = 4;
const RESOLUTION_INCH = 2;
const RESOLUTION_CENTIMETER = 3;

interface WorkerScope {
  onmessage: ((event: MessageEvent<TiffRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

let modulePromise: Promise<AuroraTiffModule> | null = null;
const workerScope = self as unknown as WorkerScope;
const documents = new Map<number, { handle: number; count: number; file: Omit<DecodeFile, "buffer"> }>();
const acknowledgements = new Map<number, (proceed: boolean) => void>();

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.operation === "continue" || request.operation === "cancel") {
    acknowledgements.get(request.id)?.(request.operation === "continue");
    acknowledgements.delete(request.id);
    return;
  }
  void handleRequest(request).catch((reason: unknown) => {
    if (!("id" in request)) return;
    workerScope.postMessage({
      id: request.id,
      kind: "error",
      errorCode: errorCode(reason),
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
};

async function handleRequest(request: Exclude<TiffRequest, { operation: "continue" | "cancel" }>) {
  const module = await getModule();
  if (request.operation === "release") {
    const document = documents.get(request.documentId);
    if (document) module._TiffDestroy(document.handle);
    documents.delete(request.documentId);
    return;
  }
  if (request.operation === "open") {
    const file = request.files[0];
    const handle = createTiff(module, new Uint8Array(file.buffer));
    const count = module._TiffCountDirectories(handle);
    if (count <= 0) {
      module._TiffDestroy(handle);
      throw new LensError(LENS_ERROR_EMPTY_DOCUMENT, "The selected file does not contain readable pages.");
    }
    documents.set(request.id, { handle, count, file: { sourceName: file.sourceName, sourceType: file.sourceType } });
    post({ id: request.id, kind: "pageCount", pageCount: count });
    post({ id: request.id, kind: "done" });
    return;
  }
  if (request.operation === "page") {
    const document = documents.get(request.documentId);
    if (!document || !Number.isInteger(request.pageIndex) || request.pageIndex < 0 || request.pageIndex >= document.count) {
      throw new LensError(LENS_ERROR_PAGE_OUT_OF_RANGE, `Failed to open page ${request.pageIndex + 1}.`);
    }
    setDirectory(module, document.handle, request.pageIndex);
    const page = readPage(module, document.handle, document.file.sourceName, document.file.sourceType, request.pageIndex, document.count, request.raster);
    post({ id: request.id, kind: "pageReady", importIndex: request.pageIndex, page }, [page.pixels.buffer]);
    post({ id: request.id, kind: "done" });
    return;
  }
  await decode(request);
}

async function decode(request: DecodeRequest): Promise<void> {
  const module = await getModule();
  const pageCounts = request.files.map((file) => countPages(module, file.buffer));
  const pageCount = pageCounts.reduce((sum, count) => sum + count, 0);
  post({ id: request.id, kind: "pageCount", pageCount });
  if (request.operation === "count") {
    post({ id: request.id, kind: "done" });
    return;
  }

  let importIndex = 0;
  for (let fileIndex = 0; fileIndex < request.files.length; fileIndex += 1) {
    const file = request.files[fileIndex];
    const handle = createTiff(module, new Uint8Array(file.buffer));
    try {
      for (let pageIndex = 0; pageIndex < pageCounts[fileIndex]; pageIndex += 1) {
        setDirectory(module, handle, pageIndex);
        const page = readPage(module, handle, file.sourceName, file.sourceType, pageIndex, pageCounts[fileIndex], request.raster);
        const processed = new Promise<boolean>(resolve => acknowledgements.set(request.id, resolve));
        post({ id: request.id, kind: "pageReady", importIndex, page }, [page.pixels.buffer]);
        if (!await processed) return;
        importIndex += 1;
      }
    } finally {
      module._TiffDestroy(handle);
    }
  }

  post({ id: request.id, kind: "done" });
}

function countPages(module: AuroraTiffModule, buffer: ArrayBuffer) {
  const handle = createTiff(module, new Uint8Array(buffer));
  try {
    const count = module._TiffCountDirectories(handle);
    if (count <= 0) {
      throw new LensError(LENS_ERROR_EMPTY_DOCUMENT, "The selected file does not contain readable pages.");
    }
    return count;
  } finally {
    module._TiffDestroy(handle);
  }
}

function readPage(module: AuroraTiffModule, handle: number, sourceName: string, sourceType: DecodedPage["sourceType"], pageIndex: number, pageCount: number, raster: RasterConfig): DecodedPage {
  const width = module._TiffGetWidth(handle);
  const height = module._TiffGetHeight(handle);
  if (width > raster.maxRasterWidth || height > raster.maxRasterHeight || width * height > raster.maxRasterPixels) {
    throw new LensError(LENS_ERROR_RASTER_LIMIT, "The selected TIFF page exceeds the configured raster limits.");
  }
  const byteLength = width * height * RGBA_CHANNELS;
  const pointer = allocate(module, byteLength);

  try {
    const ok = module._TiffReadRGBA(handle, pointer, byteLength);
    if (!ok) {
      throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "Failed to decode the selected page.");
    }
    const resolution = readResolution(module, handle);
    return {
      sourceName,
      sourceType,
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount,
      width,
      height,
      pixels: new Uint8ClampedArray(module.HEAPU8.slice(pointer, pointer + byteLength).buffer),
      xResolution: resolution.xResolution,
      yResolution: resolution.yResolution,
    };
  } finally {
    module._free(pointer);
  }
}

function readResolution(module: AuroraTiffModule, handle: number) {
  const xResolution = module._TiffGetXResolution(handle);
  const yResolution = module._TiffGetYResolution(handle);
  const unit = module._TiffGetResolutionUnit(handle);
  if (xResolution <= 0 || yResolution <= 0) {
    return { xResolution: 0, yResolution: 0 };
  }
  if (unit === RESOLUTION_INCH) {
    return { xResolution, yResolution };
  }
  if (unit === RESOLUTION_CENTIMETER) {
    return {
      xResolution: xResolution * 2.54,
      yResolution: yResolution * 2.54,
    };
  }
  return { xResolution: 0, yResolution: 0 };
}

function createTiff(module: AuroraTiffModule, bytes: Uint8Array): number {
  const pointer = allocate(module, bytes.byteLength);
  try {
    module.HEAPU8.set(bytes, pointer);
    const handle = module._TiffCreate(pointer, bytes.byteLength);
    if (!handle) {
      throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "Failed to open the selected file.");
    }
    return handle;
  } finally {
    module._free(pointer);
  }
}

function setDirectory(module: AuroraTiffModule, handle: number, pageIndex: number) {
  const ok = module._TiffSetDirectory(handle, pageIndex);
  if (!ok) {
    throw new LensError(LENS_ERROR_PAGE_OUT_OF_RANGE, `Failed to open page ${pageIndex + 1}.`);
  }
}

function allocate(module: AuroraTiffModule, byteLength: number): number {
  const pointer = module._malloc(byteLength);
  if (!pointer) {
    throw new LensError(LENS_ERROR_UNKNOWN, "AuroraTiff could not allocate decoder memory.");
  }
  return pointer;
}

function getModule(): Promise<AuroraTiffModule> {
  modulePromise ??= createAuroraTiffModule();
  return modulePromise;
}

function post(response: DecodeResponse, transfer?: Transferable[]) {
  workerScope.postMessage(response, transfer);
}

function errorCode(error: unknown): LensErrorCode {
  return error instanceof LensError ? error.code : LENS_ERROR_UNKNOWN;
}
