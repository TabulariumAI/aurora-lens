import {
  LENS_ERROR_UNKNOWN,
  LensError,
} from "../errors/LensError";
import { defaultViewerConfig, type RasterConfig } from "../config/viewerConfig";
import { detectDocType } from "./detect";
import {
  DOC_TYPE_JPEG,
  DOC_TYPE_PDF,
  DOC_TYPE_PNG,
  DOC_TYPE_TIFF,
  type DecodeFile,
  type DecodeResponse,
  type DecodeSink,
  type DocType,
} from "./types";

type Pending = {
  queue: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  sink: DecodeSink;
  worker: Worker;
  acknowledge: boolean;
};

export class DocumentDecoder {
  private readonly workers = new Map<DocType, Worker>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private generation = 0;
  private tiff: { file: File; ready: Promise<{ id: number; count: number }> } | null = null;

  async decodeDoc(file: File, sink: DecodeSink, raster: RasterConfig = defaultViewerConfig().view, startPage?: () => number): Promise<void> {
    await this.decodeDocs([file], sink, raster, startPage);
  }

  async decodeDocs(files: File[], sink: DecodeSink, raster: RasterConfig = defaultViewerConfig().view, startPage?: () => number): Promise<void> {
    const generation = this.generation;
    const decodeFiles = await Promise.all(files.map(async (file) => {
      const buffer = await file.arrayBuffer();
      const sourceType = detectDocType(new Uint8Array(buffer), file);
      return {
        buffer,
        sourceName: file.name,
        sourceType,
      };
    }));

    if (generation !== this.generation) throw new DOMException("Document decoder closed.", "AbortError");
    if (startPage && decodeFiles.length === 1 && decodeFiles[0].sourceType === DOC_TYPE_TIFF) {
      const source = await this.openTiff(files[0], raster, decodeFiles[0]);
      await sink.pageCount(source.count, DOC_TYPE_TIFF);
      if (generation !== this.generation) throw new DOMException("Document decoder closed.", "AbortError");
      await this.decodePage(files[0], startPage(), sink, raster);
      return;
    }

    const counts: number[] = [];
    let total = 0;
    for (const file of decodeFiles) {
      const count = await this.countPages(file.sourceType, [file], raster);
      counts.push(count);
      total += count;
    }
    await sink.pageCount(total, decodeFiles.length === 1 ? decodeFiles[0].sourceType : undefined);

    let offset = 0;
    for (let index = 0; index < decodeFiles.length; index += 1) {
      if (generation !== this.generation) throw new DOMException("Document decoder closed.", "AbortError");
      const file = decodeFiles[index];
      await this.decodeType(file.sourceType, [file], offset, sink, raster);
      offset += counts[index];
    }
  }

  close(): void {
    this.generation += 1;
    this.tiff = null;
    this.rejectAll(new DOMException("Document decoder closed.", "AbortError"));
    this.workers.forEach((worker) => worker.terminate());
    this.workers.clear();
  }

  async decodePage(file: File, pageIndex: number, sink: DecodeSink, raster: RasterConfig): Promise<void> {
    const generation = this.generation;
    const source = await this.openTiff(file, raster);
    if (generation !== this.generation) throw new DOMException("Document decoder closed.", "AbortError");
    const id = this.nextId++;
    const worker = this.worker(DOC_TYPE_TIFF);
    await new Promise<void>((resolve, reject) => {
      this.pending.set(id, { queue: Promise.resolve(), resolve, reject, sink, worker, acknowledge: false });
      worker.postMessage({ id, operation: "page", documentId: source.id, pageIndex, raster });
    });
  }

  private openTiff(file: File, raster: RasterConfig, input?: DecodeFile) {
    if (this.tiff?.file === file) return this.tiff.ready;
    const generation = this.generation;
    const previous = this.tiff;
    const ready = (async () => {
      if (previous) {
        const source = await previous.ready;
        this.workers.get(DOC_TYPE_TIFF)?.postMessage({ operation: "release", documentId: source.id });
      }
      const source = input ?? { buffer: await file.arrayBuffer(), sourceName: file.name, sourceType: DOC_TYPE_TIFF };
      if (generation !== this.generation) throw new DOMException("Document decoder closed.", "AbortError");
      const id = this.nextId;
      let count = 0;
      await this.send(DOC_TYPE_TIFF, "open", [source], raster, { pageCount(value) { count = value; }, pageReady() {} });
      return { id, count };
    })();
    this.tiff = { file, ready };
    return ready;
  }

  private async countPages(type: DocType, files: DecodeFile[], raster: RasterConfig) {
    let count = 0;
    await this.send(type, "count", files, raster, {
      pageCount(value) { count = value; },
      pageReady() {},
    });
    return count;
  }

  private decodeType(type: DocType, files: DecodeFile[], offset: number, sink: DecodeSink, raster: RasterConfig) {
    return this.send(type, "decode", files, raster, {
      pageCount: () => undefined,
      pageReady: (page, importIndex) => sink.pageReady(page, offset + importIndex),
    });
  }

  private send(type: DocType, operation: "count" | "decode" | "open", files: DecodeFile[], raster: RasterConfig, sink: DecodeSink) {
    const id = this.nextId;
    this.nextId += 1;
    const worker = this.worker(type);

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        queue: Promise.resolve(),
        resolve,
        reject,
        sink,
        worker,
        acknowledge: type === DOC_TYPE_TIFF && operation === "decode",
      });
      const request = { id, operation, raster, files };
      if (operation !== "count") {
        worker.postMessage(request, files.map((file) => file.buffer));
      } else {
        worker.postMessage(request);
      }
    });
  }

  private worker(type: DocType) {
    const current = this.workers.get(type);
    if (current) {
      return current;
    }

    let worker: Worker;
    switch (type) {
      case DOC_TYPE_TIFF:
        worker = new Worker(new URL("./workers/tiffWorker.js", import.meta.url), { type: "module" });
        break;
      case DOC_TYPE_PDF:
        worker = new Worker(new URL("./workers/pdfWorker.js", import.meta.url), { type: "module" });
        break;
      case DOC_TYPE_PNG:
      case DOC_TYPE_JPEG:
        worker = new Worker(new URL("./workers/rasterWorker.js", import.meta.url), { type: "module" });
        break;
      default:
        throw new LensError(LENS_ERROR_UNKNOWN, "Document decoder received an unknown format.");
    }
    worker.onmessage = (event: MessageEvent<DecodeResponse>) => this.receive(event.data);
    worker.onerror = (event) => this.failWorker(event);
    worker.onmessageerror = () => this.failWorker(new LensError(LENS_ERROR_UNKNOWN, "Document decoder worker returned an unreadable response."));
    this.workers.set(type, worker);
    return worker;
  }

  private receive(response: DecodeResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    pending.queue = pending.queue.then(async () => {
      if (this.pending.get(response.id) !== pending) return;
      if (response.kind === "error") {
        this.pending.delete(response.id);
        pending.reject(new LensError(response.errorCode, response.error));
        return;
      }
      if (response.kind === "pageCount") {
        await pending.sink.pageCount(response.pageCount);
        return;
      }
      if (response.kind === "pageReady") {
        await pending.sink.pageReady(response.page, response.importIndex);
        if (pending.acknowledge && this.pending.get(response.id) === pending) {
          pending.worker.postMessage({ id: response.id, operation: "continue" });
        }
        return;
      }
      this.pending.delete(response.id);
      pending.resolve();
    }).catch((error: unknown) => {
      if (pending.acknowledge) pending.worker.postMessage({ id: response.id, operation: "cancel" });
      this.pending.delete(response.id);
      pending.reject(error instanceof Error ? error : new LensError(LENS_ERROR_UNKNOWN, String(error)));
    });
  }

  private failWorker(error: unknown) {
    this.rejectAll(error);
    this.close();
  }

  private rejectAll(error: unknown) {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
