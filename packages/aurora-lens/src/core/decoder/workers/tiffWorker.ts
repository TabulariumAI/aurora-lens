import {
  LENS_ERROR_EMPTY_DOCUMENT,
  LENS_ERROR_PAGE_OUT_OF_RANGE,
  LENS_ERROR_UNKNOWN,
  LENS_ERROR_UNREADABLE_DOCUMENT,
  LensError,
  type LensErrorCode,
} from "../../errors/LensError";
import type { DecodeRequest, DecodeResponse, DecodedPage } from "../types";
import createAuroraTiffModule from "../vendor/auroraTiff.js";
import type { AuroraTiffModule } from "../vendor/auroraTiff";

const RGBA_CHANNELS = 4;
const RESOLUTION_INCH = 2;
const RESOLUTION_CENTIMETER = 3;

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

let modulePromise: Promise<AuroraTiffModule> | null = null;
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
        const page = readPage(module, handle, file.sourceName, file.sourceType, pageIndex, pageCounts[fileIndex]);
        post({ id: request.id, kind: "pageReady", importIndex, page }, [page.pixels.buffer]);
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

function readPage(module: AuroraTiffModule, handle: number, sourceName: string, sourceType: DecodedPage["sourceType"], pageIndex: number, pageCount: number): DecodedPage {
  const width = module._TiffGetWidth(handle);
  const height = module._TiffGetHeight(handle);
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
