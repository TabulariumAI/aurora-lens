import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TiffExporter } from "./TiffExporter";
import { defaultViewerConfig } from "../config/viewerConfig";
import type { ExportResponse } from "./types";

class ExportWorker {
  static instances: ExportWorker[] = [];
  static failSend = false;
  onmessage: ((event: MessageEvent<ExportResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => { if (ExportWorker.failSend) throw new Error("Send failed"); });
  terminate = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { ExportWorker.instances.push(this); }
}

beforeEach(() => {
  ExportWorker.instances = [];
  ExportWorker.failSend = false;
  vi.stubGlobal("Worker", ExportWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe("TiffExporter worker client", () => {
  it("sends stored blobs and config to a module worker and forwards progress before resolving", async () => {
    const exporter = new TiffExporter();
    const progress = vi.fn();
    const pages = [{ pageId: "page-1", blob: new Blob(["png"]), width: 10, height: 10, xResolution: 300, yResolution: 300 }];
    const config = defaultViewerConfig().export;
    const result = exporter.export(pages, config, progress);
    const worker = ExportWorker.instances[0];
    expect(worker.url.pathname).toMatch(/workers\/tiffExportWorker\.ts$/);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.postMessage).toHaveBeenCalledWith({ pages, config });
    const value = { phase: "pages", completed: 1, total: 1 } as const;
    worker.onmessage!({ data: { kind: "progress", progress: value } } as MessageEvent<ExportResponse>);
    expect(progress).toHaveBeenCalledWith(value);
    expect(worker.terminate).not.toHaveBeenCalled();
    const blob = new Blob(["tiff"], { type: "image/tiff" });
    worker.onmessage!({ data: { kind: "done", blob } } as MessageEvent<ExportResponse>);
    await expect(result).resolves.toBe(blob);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "crash", "message", "send", "callback"])("rejects and terminates on %s failure", async (failure) => {
    ExportWorker.failSend = failure === "send";
    const exporter = new TiffExporter();
    const error = new Error("Export failed");
    const result = exporter.export([], defaultViewerConfig().export, () => { throw error; });
    const worker = ExportWorker.instances[0];
    const rejected = expect(result).rejects.toBeInstanceOf(Error);
    if (failure === "error") worker.onmessage!({ data: { kind: "error", errorCode: "raster_limit", error: "Too large" } } as MessageEvent<ExportResponse>);
    if (failure === "crash") worker.onerror!({ message: "Worker crashed" } as ErrorEvent);
    if (failure === "message") worker.onmessageerror!();
    if (failure === "callback") worker.onmessage!({ data: { kind: "progress", progress: { phase: "pages", completed: 0, total: 1 } } } as MessageEvent<ExportResponse>);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("aborts every active worker on close and allows a subsequent export", async () => {
    const exporter = new TiffExporter();
    const first = exporter.export([], defaultViewerConfig().export);
    const second = exporter.export([], defaultViewerConfig().export);
    const rejected = [expect(first).rejects.toMatchObject({ name: "AbortError" }), expect(second).rejects.toMatchObject({ name: "AbortError" })];
    exporter.close();
    await Promise.all(rejected);
    for (const worker of ExportWorker.instances) expect(worker.terminate).toHaveBeenCalledTimes(1);
    const result = exporter.export([], defaultViewerConfig().export);
    const blob = new Blob(["tiff"]);
    ExportWorker.instances[2].onmessage!({ data: { kind: "done", blob } } as MessageEvent<ExportResponse>);
    await expect(result).resolves.toBe(blob);
  });
});
