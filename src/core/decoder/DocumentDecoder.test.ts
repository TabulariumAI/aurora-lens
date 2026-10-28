import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentDecoder } from "./DocumentDecoder";
import { defaultViewerConfig } from "../config/viewerConfig";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: any[] = [];
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  postMessage(request: any) { this.messages.push(request); }
  reply(response: any) { this.onmessage?.({ data: response } as MessageEvent); }
}

const raster = defaultViewerConfig().view;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function tiff() {
  const file = new File([new Uint8Array([73, 73, 42, 0])], "pages.tiff");
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([73, 73, 42, 0]).buffer });
  return file;
}
function ready(id: number, pageIndex: number) {
  return { id, kind: "pageReady", importIndex: pageIndex, page: {
    sourceName: "pages.tiff", sourceType: "tiff", pageIndex, pageNumber: pageIndex + 1,
    pageCount: 20, width: 1, height: 1, pixels: new Uint8ClampedArray(4), xResolution: 1, yResolution: 1,
  } };
}

describe("DocumentDecoder bounded TIFF requests", () => {
  it("bubbles the original runtime event and cause", async () => {
    const result = decoder.decodeDoc(tiff(), { pageCount: vi.fn(), pageReady: vi.fn() });
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    const event = new ErrorEvent("error", { message: "Decode failed", error: new Error("Decode failed", { cause: new Error("Decoder module unavailable") }) });
    TestWorker.instances[0].onerror!(event);
    await expect(result).rejects.toBe(event);
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  let decoder: DocumentDecoder;
  beforeEach(() => {
    TestWorker.instances = [];
    vi.stubGlobal("Worker", TestWorker);
    decoder = new DocumentDecoder();
  });
  afterEach(() => { decoder.close(); vi.unstubAllGlobals(); });

  it("opens once and requests page 10 without decoding pages 1 through 9", async () => {
    const file = tiff();
    const sink = { pageCount: vi.fn(), pageReady: vi.fn() };
    const done = decoder.decodeDoc(file, sink, raster, () => 9);
    await tick();
    const worker = TestWorker.instances[0];
    const open = worker.messages[0];
    expect(open.operation).toBe("open");
    worker.reply({ id: open.id, kind: "pageCount", pageCount: 20 });
    worker.reply({ id: open.id, kind: "done" });
    await tick();
    const request = worker.messages.at(-1);
    expect(request.operation).toBe("page");
    expect(request.pageIndex).toBe(9);
    const response = ready(request.id, 9);
    worker.reply(response);
    worker.reply({ id: request.id, kind: "done" });
    await done;
    expect(sink.pageReady.mock.calls[0][0].pixels).toBe(response.page.pixels);
    const next = decoder.decodePage(file, 10, sink, raster);
    await tick();
    const second = worker.messages.at(-1);
    expect(worker.messages.filter(value => value.operation === "open")).toHaveLength(1);
    worker.reply(ready(second.id, 10));
    worker.reply({ id: second.id, kind: "done" });
    await next;
  });

  it("acknowledges a bulk TIFF page only after its sink finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const done = decoder.decodeDocs([tiff()], { pageCount() {}, pageReady: () => gate }, raster);
    await tick();
    const worker = TestWorker.instances[0];
    const count = worker.messages[0];
    worker.reply({ id: count.id, kind: "pageCount", pageCount: 20 });
    worker.reply({ id: count.id, kind: "done" });
    await tick();
    const request = worker.messages.at(-1);
    worker.reply(ready(request.id, 0));
    await tick();
    expect(worker.messages.filter(value => value.operation === "continue")).toHaveLength(0);
    release();
    await tick();
    expect(worker.messages.at(-1)).toMatchObject({ id: request.id, operation: "continue" });
    worker.reply({ id: request.id, kind: "done" });
    await done;
  });

  it("cancels a bulk TIFF worker when persistence fails", async () => {
    const done = decoder.decodeDocs([tiff()], { pageCount() {}, pageReady() { throw new Error("storage failed"); } }, raster);
    const rejected = expect(done).rejects.toThrow("storage failed");
    await tick();
    const worker = TestWorker.instances[0];
    const count = worker.messages[0];
    worker.reply({ id: count.id, kind: "pageCount", pageCount: 20 });
    worker.reply({ id: count.id, kind: "done" });
    await tick();
    const request = worker.messages.at(-1);
    worker.reply(ready(request.id, 0));
    await rejected;
    expect(worker.messages.at(-1)).toMatchObject({ id: request.id, operation: "cancel" });
  });

  it("rejects pending work and terminates workers on close", async () => {
    const done = decoder.decodeDoc(tiff(), { pageCount() {}, pageReady() {} }, raster, () => 9);
    const rejected = expect(done).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    const worker = TestWorker.instances[0];
    decoder.close();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(["onerror", "onmessageerror"] as const)("releases a failed worker after %s and starts fresh on retry", async event => {
    const done = decoder.decodeDoc(tiff(), { pageCount() {}, pageReady() {} }, raster, () => 0);
    const rejected = expect(done).rejects.toMatchObject(event === "onerror" ? { message: "worker failed" } : { code: "unknown" });
    await tick();
    const failed = TestWorker.instances[0];
    if (event === "onerror") failed.onerror!({ message: "worker failed" });
    else failed.onmessageerror!();
    await rejected;
    expect(failed.terminate).toHaveBeenCalledOnce();
    const retried = decoder.decodeDoc(tiff(), { pageCount() {}, pageReady() {} }, raster, () => 0);
    const canceled = expect(retried).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    expect(TestWorker.instances).toHaveLength(2);
    decoder.close();
    await canceled;
  });
});
