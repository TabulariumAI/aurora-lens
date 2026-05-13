import {
  DECODER_ERROR_UNKNOWN,
  DecoderError,
  type DecoderErrorCode,
} from "../DecoderError";
import { defaultViewerConfig, type RasterConfig } from "../viewerConfig";
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
  reject: (error: Error) => void;
  sink: DecodeSink;
};

export class DocumentDecoder {
  private readonly workers = new Map<DocType, Worker>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  async decodeDoc(file: File, sink: DecodeSink, raster: RasterConfig = defaultViewerConfig().view): Promise<void> {
    await this.decodeDocs([file], sink, raster);
  }

  async decodeDocs(files: File[], sink: DecodeSink, raster: RasterConfig = defaultViewerConfig().view): Promise<void> {
    const decodeFiles = await Promise.all(files.map(async (file) => {
      const buffer = await file.arrayBuffer();
      const sourceType = detectDocType(new Uint8Array(buffer), file);
      return {
        buffer,
        sourceName: file.name,
        sourceType,
      };
    }));

    const counts: number[] = [];
    let total = 0;
    for (const file of decodeFiles) {
      const count = await this.countPages(file.sourceType, [file], raster);
      counts.push(count);
      total += count;
    }
    await sink.pageCount(total);

    let offset = 0;
    for (let index = 0; index < decodeFiles.length; index += 1) {
      const file = decodeFiles[index];
      await this.decodeType(file.sourceType, [file], offset, sink, raster);
      offset += counts[index];
    }
  }

  close(): void {
    this.rejectAll(new DOMException("Document decoder closed.", "AbortError"));
    this.workers.forEach((worker) => worker.terminate());
    this.workers.clear();
  }

  private countPages(type: DocType, files: DecodeFile[], raster: RasterConfig) {
    return new Promise<number>((resolve, reject) => {
      let count = 0;
      this.send(type, "count", files, raster, {
        pageCount: (value) => {
          count = value;
        },
        pageReady: () => undefined,
      }).then(() => resolve(count)).catch(reject);
    });
  }

  private decodeType(type: DocType, files: DecodeFile[], offset: number, sink: DecodeSink, raster: RasterConfig) {
    return this.send(type, "decode", files, raster, {
      pageCount: () => undefined,
      pageReady: (page, importIndex) => sink.pageReady(page, offset + importIndex),
    });
  }

  private send(type: DocType, operation: "count" | "decode", files: DecodeFile[], raster: RasterConfig, sink: DecodeSink) {
    const id = this.nextId;
    this.nextId += 1;
    const worker = this.worker(type);

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        queue: Promise.resolve(),
        resolve,
        reject,
        sink,
      });
      const request = { id, operation, raster, files };
      if (operation === "decode") {
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

    const worker = new Worker(this.workerUrl(type), { type: "module" });
    worker.onmessage = (event: MessageEvent<DecodeResponse>) => this.receive(event.data);
    worker.onerror = (event) => this.rejectAll(new DecoderError(DECODER_ERROR_UNKNOWN, event.message || "Document decoder worker failed."));
    worker.onmessageerror = () => this.rejectAll(new DecoderError(DECODER_ERROR_UNKNOWN, "Document decoder worker returned an unreadable response."));
    this.workers.set(type, worker);
    return worker;
  }

  private workerUrl(type: DocType) {
    if (type === DOC_TYPE_TIFF) {
      return new URL("./workers/tiffWorker.js", import.meta.url);
    }
    if (type === DOC_TYPE_PDF) {
      return new URL("./workers/pdfWorker.js", import.meta.url);
    }
    if (type === DOC_TYPE_PNG || type === DOC_TYPE_JPEG) {
      return new URL("./workers/rasterWorker.js", import.meta.url);
    }
    throw new DecoderError(DECODER_ERROR_UNKNOWN, "Document decoder received an unknown format.");
  }

  private receive(response: DecodeResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    pending.queue = pending.queue.then(async () => {
      if (response.kind === "error") {
        this.pending.delete(response.id);
        pending.reject(new DecoderError(response.errorCode, response.error));
        return;
      }
      if (response.kind === "pageCount") {
        await pending.sink.pageCount(response.pageCount);
        return;
      }
      if (response.kind === "pageReady") {
        await pending.sink.pageReady({
          ...response.page,
          pixels: new Uint8ClampedArray(response.page.pixels),
        }, response.importIndex);
        return;
      }
      this.pending.delete(response.id);
      pending.resolve();
    }).catch((error: unknown) => {
      this.pending.delete(response.id);
      pending.reject(error instanceof Error ? error : new DecoderError(DECODER_ERROR_UNKNOWN, String(error)));
    });
  }

  private rejectAll(error: Error) {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
