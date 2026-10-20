import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultViewerConfig } from "../../config/viewerConfig";

describe("raster worker", () => {
  let scope: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
  const close = vi.fn();
  const canvas = vi.fn();
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    scope = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 200, close }));
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(width: number, height: number) { canvas(width, height); }
      getContext() { return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(4) }) }; }
    });
    await import("./rasterWorker");
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["maxRasterPixels", "maxRasterWidth", "maxRasterHeight"])("rejects %s before canvas allocation and releases the bitmap", async limit => {
    scope.onmessage!({ data: { id: 1, operation: "decode", raster: { ...defaultViewerConfig().view, [limit]: 10 }, files: [{ buffer: new ArrayBuffer(8), sourceName: "large.png", sourceType: "png" }] } });
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", errorCode: "raster_limit" })));
    expect(canvas).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases the bitmap after decoding", async () => {
    scope.onmessage!({ data: { id: 1, operation: "decode", raster: defaultViewerConfig().view, files: [{ buffer: new ArrayBuffer(8), sourceName: "page.png", sourceType: "png" }] } });
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ id: 1, kind: "done" }, undefined));
    expect(canvas).toHaveBeenCalledWith(100, 200);
    expect(close).toHaveBeenCalledOnce();
  });
});
