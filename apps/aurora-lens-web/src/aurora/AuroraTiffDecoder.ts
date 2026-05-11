import type { ViewerDecoder, RasterPage } from "@tabularium/aurora-lens";

type DecodeKind = "page" | "thumbnail";

interface PendingRequest {
  kind: DecodeKind;
  resolve: (page: RasterPage) => void;
  reject: (error: Error) => void;
}

interface WorkerResponse {
  id: number;
  kind: DecodeKind;
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
    if (!pending || pending.kind !== response.kind) {
      return;
    }
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
      return;
    }
    if (!response.page) {
      pending.reject(new Error("AuroraTiff decoder returned no page."));
      return;
    }

    pending.resolve({
      ...response.page,
      pixels: new Uint8ClampedArray(response.page.pixels),
    });
  }

  private rejectAll(error: Error) {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
