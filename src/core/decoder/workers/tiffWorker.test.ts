import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultViewerConfig } from "../../config/viewerConfig";

const tiff = vi.hoisted(() => ({
  HEAPU8: new Uint8Array(4096), _malloc: vi.fn(() => 8), _free: vi.fn(),
  _TiffCreate: vi.fn(() => 1), _TiffDestroy: vi.fn(), _TiffCountDirectories: vi.fn(() => 20),
  _TiffSetDirectory: vi.fn(() => 1), _TiffReadRGBA: vi.fn(() => 1),
  _TiffGetWidth: vi.fn(() => 2), _TiffGetHeight: vi.fn(() => 2),
  _TiffGetXResolution: vi.fn(() => 300), _TiffGetYResolution: vi.fn(() => 300),
  _TiffGetResolutionUnit: vi.fn(() => 2),
}));
vi.mock("../vendor/auroraTiff.js", () => ({ default: async () => tiff }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("TIFF worker", () => {
  let scope: { onmessage: ((event: { data: any }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
  const request = (operation: string, id = 1) => ({
    id, operation, raster: defaultViewerConfig().view,
    files: [{ buffer: new ArrayBuffer(4), sourceName: "test.tiff", sourceType: "tiff" }],
  });
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    tiff._TiffCountDirectories.mockReturnValue(20);
    tiff._TiffReadRGBA.mockReturnValue(1);
    scope = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal("self", scope);
    await import("./tiffWorker");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts without decoding, then selects only the requested directory", async () => {
    scope.onmessage!({ data: request("open") });
    await tick();
    expect(tiff._TiffReadRGBA).not.toHaveBeenCalled();
    scope.onmessage!({ data: { id: 2, operation: "page", documentId: 1, pageIndex: 9, raster: defaultViewerConfig().view } });
    await tick();
    expect(tiff._TiffSetDirectory.mock.calls.map(call => call[1])).toEqual([9]);
    expect(scope.postMessage.mock.calls.find(call => call[0].kind === "pageReady")?.[0].page.pageNumber).toBe(10);
    scope.onmessage!({ data: { operation: "release", documentId: 1 } });
    await tick();
    expect(tiff._TiffDestroy).toHaveBeenCalledOnce();
  });

  it("bounds bulk output to one unacknowledged pixel buffer and releases on cancellation", async () => {
    scope.onmessage!({ data: request("decode") });
    await tick();
    expect(tiff._TiffReadRGBA).toHaveBeenCalledTimes(1);
    scope.onmessage!({ data: { id: 1, operation: "continue" } });
    await tick();
    expect(tiff._TiffReadRGBA).toHaveBeenCalledTimes(2);
    scope.onmessage!({ data: { id: 1, operation: "cancel" } });
    await tick();
    expect(tiff._TiffReadRGBA).toHaveBeenCalledTimes(2);
    expect(tiff._TiffDestroy).toHaveBeenCalledTimes(2);
  });

  it("rejects out-of-range pages without allocating pixels", async () => {
    scope.onmessage!({ data: request("open") }); await tick();
    scope.onmessage!({ data: { id: 2, operation: "page", documentId: 1, pageIndex: 20, raster: defaultViewerConfig().view } });
    await tick();
    expect(tiff._TiffReadRGBA).not.toHaveBeenCalled();
    expect(scope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "error", errorCode: "page_out_of_range" });
  });

  it("releases empty documents and reports decoding errors", async () => {
    tiff._TiffCountDirectories.mockReturnValue(0);
    scope.onmessage!({ data: request("open") }); await tick();
    expect(tiff._TiffDestroy).toHaveBeenCalledOnce();
    expect(scope.postMessage.mock.calls.at(-1)?.[0].kind).toBe("error");
  });

  it("rejects TIFF pages beyond the configured raster budget before decoding pixels", async () => {
    scope.onmessage!({ data: request("open") }); await tick();
    const raster = { ...defaultViewerConfig().view, maxRasterPixels: 3 };
    scope.onmessage!({ data: { id: 2, operation: "page", documentId: 1, pageIndex: 0, raster } });
    await tick();
    expect(tiff._TiffReadRGBA).not.toHaveBeenCalled();
    expect(scope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "error", errorCode: "raster_limit" });
    scope.onmessage!({ data: { operation: "release", documentId: 1 } });
    await tick();
    expect(tiff._TiffDestroy).toHaveBeenCalledOnce();
  });
});
