import type { RasterPage } from "@tabularium/aurora-lens";
import createAuroraTiffModule from "./vendor/auroraTiff.js";
import type { AuroraTiffModule } from "./auroraTiff";

const rgbaChannelCount = 4;

type DecodeKind = "page" | "thumbnail";

interface DecodeRequest {
  id: number;
  kind: DecodeKind;
  buffer: ArrayBuffer;
  pageIndex: number;
  sourceName: string;
}

interface DecodeResponse {
  id: number;
  kind: DecodeKind;
  page?: RasterPage;
  error?: string;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

let modulePromise: Promise<AuroraTiffModule> | null = null;
const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const request = event.data;

  void decode(request)
    .then((page) => {
      const response: DecodeResponse = {
        id: request.id,
        kind: request.kind,
        page,
      };
      workerScope.postMessage(response, [page.pixels.buffer]);
    })
    .catch((reason: unknown) => {
      const response: DecodeResponse = {
        id: request.id,
        kind: request.kind,
        error: reason instanceof Error ? reason.message : String(reason),
      };
      workerScope.postMessage(response);
    });
};

async function decode(request: DecodeRequest): Promise<RasterPage> {
  const module = await getModule();
  const bytes = new Uint8Array(request.buffer);
  const handle = createTiff(module, bytes);

  try {
    const pageCount = module._TiffCountDirectories(handle);
    if (pageCount <= 0) {
      throw new Error("The selected file does not contain readable pages.");
    }
    if (request.pageIndex < 0 || request.pageIndex >= pageCount) {
      throw new Error(`Page ${request.pageIndex + 1} is outside the available page range.`);
    }
    setDirectory(module, handle, request.pageIndex);
    const image = readImage(module, handle);

    return {
      sourceName: request.sourceName,
      pageIndex: request.pageIndex,
      pageNumber: request.pageIndex + 1,
      pageCount,
      width: image.width,
      height: image.height,
      pixels: image.pixels,
    };
  } finally {
    module._TiffDestroy(handle);
  }
}

function getModule(): Promise<AuroraTiffModule> {
  modulePromise ??= createAuroraTiffModule();
  return modulePromise;
}

function createTiff(module: AuroraTiffModule, bytes: Uint8Array): number {
  const pointer = allocate(module, bytes.byteLength);

  try {
    module.HEAPU8.set(bytes, pointer);
    const handle = module._TiffCreate(pointer, bytes.byteLength);
    if (!handle) {
      throw new Error("Failed to open the selected file.");
    }
    return handle;
  } finally {
    module._free(pointer);
  }
}

function setDirectory(module: AuroraTiffModule, handle: number, pageIndex: number) {
  const ok = module._TiffSetDirectory(handle, pageIndex);
  if (!ok) {
    throw new Error(`Failed to open page ${pageIndex + 1}.`);
  }
}

function readImage(module: AuroraTiffModule, handle: number) {
  const width = module._TiffGetWidth(handle);
  const height = module._TiffGetHeight(handle);
  const byteLength = width * height * rgbaChannelCount;
  const pointer = allocate(module, byteLength);

  try {
    const ok = module._TiffReadRGBA(handle, pointer, byteLength);
    if (!ok) {
      throw new Error("Failed to decode the selected page.");
    }
    return {
      width,
      height,
      pixels: new Uint8ClampedArray(module.HEAPU8.slice(pointer, pointer + byteLength).buffer),
    };
  } finally {
    module._free(pointer);
  }
}

function allocate(module: AuroraTiffModule, byteLength: number): number {
  const pointer = module._malloc(byteLength);
  if (!pointer) {
    throw new Error("AuroraTiff could not allocate decoder memory.");
  }
  return pointer;
}
