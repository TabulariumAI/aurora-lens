import type { RasterPage } from "@tabularium/aurora-lens";
import createAuroraTiffModule from "./vendor/auroraTiff.js";
import type { AuroraTiffModule } from "./auroraTiff";

const rgbaChannelCount = 4;

type DecodeKind = "page" | "thumbnail";

interface DecodeFile {
  buffer: ArrayBuffer;
  sourceName: string;
}

type DecodeRequest = PageRequest | ImportRequest;

interface PageRequest {
  id: number;
  kind: DecodeKind;
  buffer: ArrayBuffer;
  pageIndex: number;
  sourceName: string;
}

interface ImportRequest {
  id: number;
  kind: "import";
  files: DecodeFile[];
}

interface DecodeResponse {
  id: number;
  kind: DecodeKind | "importCount" | "importPage" | "importDone";
  importIndex?: number;
  pageCount?: number;
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

  if (request.kind === "import") {
    void importPages(request).catch((reason: unknown) => {
      workerScope.postMessage({
        id: request.id,
        kind: "importDone",
        error: reason instanceof Error ? reason.message : String(reason),
      });
    });
    return;
  }

  void decode(request)
    .then((page) => {
      postPage(request.id, request.kind, page);
    })
    .catch((reason: unknown) => {
      workerScope.postMessage({
        id: request.id,
        kind: request.kind,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    });
};

async function decode(request: PageRequest): Promise<RasterPage> {
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

async function importPages(request: ImportRequest): Promise<void> {
  const module = await getModule();
  const pageCounts = request.files.map((file) => countTiffPages(module, file));
  const pageCount = pageCounts.reduce((sum, count) => sum + count, 0);
  workerScope.postMessage({
    id: request.id,
    kind: "importCount",
    pageCount,
  });

  let importIndex = 0;
  for (let fileIndex = 0; fileIndex < request.files.length; fileIndex += 1) {
    const file = request.files[fileIndex];
    const bytes = new Uint8Array(file.buffer);
    const handle = createTiff(module, bytes);

    try {
      for (let pageIndex = 0; pageIndex < pageCounts[fileIndex]; pageIndex += 1) {
        setDirectory(module, handle, pageIndex);
        const image = readImage(module, handle);
        postPage(request.id, "importPage", {
          sourceName: file.sourceName,
          pageIndex,
          pageNumber: pageIndex + 1,
          pageCount: pageCounts[fileIndex],
          width: image.width,
          height: image.height,
          pixels: image.pixels,
        }, importIndex);
        importIndex += 1;
      }
    } finally {
      module._TiffDestroy(handle);
    }
  }

  workerScope.postMessage({
    id: request.id,
    kind: "importDone",
  });
}

function countTiffPages(module: AuroraTiffModule, file: DecodeFile) {
  const handle = createTiff(module, new Uint8Array(file.buffer));
  try {
    const pageCount = module._TiffCountDirectories(handle);
    if (pageCount <= 0) {
      throw new Error("The selected file does not contain readable pages.");
    }
    return pageCount;
  } finally {
    module._TiffDestroy(handle);
  }
}

function postPage(id: number, kind: DecodeResponse["kind"], page: RasterPage, importIndex?: number) {
  const response: DecodeResponse = {
    id,
    kind,
    importIndex,
    page,
  };
  workerScope.postMessage(response, [page.pixels.buffer]);
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
