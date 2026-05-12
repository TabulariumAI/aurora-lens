import type { ViewerDecoder, ViewerImportSink, RasterPage } from "@tabularium/aurora-lens";

type DecodeKind = "page" | "thumbnail";

type PendingRequest =
  | {
    kind: DecodeKind;
    resolve: (page: RasterPage) => void;
    reject: (error: Error) => void;
  }
  | {
    kind: "import";
    sink: ViewerImportSink;
    queue: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  };

interface WorkerResponse {
  id: number;
  kind: DecodeKind | "importCount" | "importPage" | "importDone";
  importIndex?: number;
  pageCount?: number;
  page?: RasterPage;
  error?: string;
}

export class AuroraTiffDecoder implements ViewerDecoder {
  private readonly worker = new Worker(new URL("./auroraTiffWorker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.receive(event.data);
    };
    this.worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || "AuroraTiff decoder worker failed."));
    };
    this.worker.onmessageerror = () => {
      this.rejectAll(new Error("AuroraTiff decoder worker returned an unreadable response."));
    };
  }

  decode(file: File, pageIndex: number): Promise<RasterPage> {
    return this.request("page", file, pageIndex);
  }

  async importPages(files: File[], sink: ViewerImportSink): Promise<void> {
    const id = this.nextId;
    this.nextId += 1;
    const workerFiles = await Promise.all(files.map(async (file) => ({
      buffer: await file.arrayBuffer(),
      sourceName: file.name,
    })));

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { kind: "import", sink, queue: Promise.resolve(), resolve, reject });
      this.worker.postMessage(
        {
          id,
          kind: "import",
          files: workerFiles,
        },
        workerFiles.map((file) => file.buffer)
      );
    });
  }

  thumbnail(file: File, pageIndex: number): Promise<RasterPage> {
    return this.request("thumbnail", file, pageIndex);
  }

  close() {
    this.rejectAll(new DOMException("AuroraTiff decoder closed.", "AbortError"));
    this.worker.terminate();
  }

  private async request(kind: DecodeKind, file: File, pageIndex: number): Promise<RasterPage> {
    const id = this.nextId;
    this.nextId += 1;
    const buffer = await file.arrayBuffer();

    return new Promise<RasterPage>((resolve, reject) => {
      this.pending.set(id, { kind, resolve, reject });
      this.worker.postMessage(
        {
          id,
          kind,
          buffer,
          pageIndex,
          sourceName: file.name,
        },
        [buffer]
      );
    });
  }

  private receive(response: WorkerResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    if (response.error) {
      this.pending.delete(response.id);
      pending.reject(new Error(response.error));
      return;
    }

    if (pending.kind === "import") {
      pending.queue = pending.queue.then(() => this.receiveImport(response.id, pending, response));
      return;
    }

    if (pending.kind !== response.kind) {
      this.pending.delete(response.id);
      pending.reject(new Error("AuroraTiff decoder returned an unexpected response."));
      return;
    }
    this.pending.delete(response.id);
    if (!response.page) {
      pending.reject(new Error("AuroraTiff decoder returned no page."));
      return;
    }

    pending.resolve({
      ...response.page,
      pixels: new Uint8ClampedArray(response.page.pixels),
    });
  }

  private async receiveImport(id: number, pending: Extract<PendingRequest, { kind: "import" }>, response: WorkerResponse) {
    try {
      if (response.kind === "importCount") {
        if (response.pageCount === undefined) {
          throw new Error("AuroraTiff decoder returned no import page count.");
        }
        await pending.sink.pageCount(response.pageCount);
        return;
      }
      if (response.kind === "importPage" && response.page !== undefined && response.importIndex !== undefined) {
        await pending.sink.pageReady({
          ...response.page,
          pixels: new Uint8ClampedArray(response.page.pixels),
        }, response.importIndex);
        return;
      }
      if (response.kind === "importDone") {
        this.pending.delete(id);
        pending.resolve();
        return;
      }
      throw new Error("AuroraTiff decoder returned an unexpected import response.");
    } catch (error) {
      this.pending.delete(id);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private rejectAll(error: Error) {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
