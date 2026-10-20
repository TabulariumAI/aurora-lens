import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../../package.json";

const pdfjsMock = vi.hoisted(() => ({
  GlobalWorkerOptions: {
    workerSrc: "",
  },
  getDocument: vi.fn(),
  render: vi.fn(() => ({ promise: Promise.resolve() })),
  getPage: vi.fn(),
  destroy: vi.fn(() => Promise.resolve()),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: pdfjsMock.GlobalWorkerOptions,
  getDocument: pdfjsMock.getDocument,
}));

const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
const {
  configurePdfWorker,
  decodePdfBytes,
  decodePdfFile,
  DEFAULT_PDF_RASTER_DPI,
} = await import("./PdfPageDecoder");
const { readPdfDocument } = await import("./pdfDocument");
const { defaultViewerConfig } = await import("../config/viewerConfig");

describe("PdfPageDecoder", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    pdfjsMock.GlobalWorkerOptions.workerSrc = "";
    pdfjsMock.getPage.mockImplementation((pageNumber: number) => Promise.resolve({
      getViewport: ({ scale }: { scale: number }) => ({
        width: pageNumber * 72 * scale,
        height: pageNumber * 144 * scale,
      }),
      render: pdfjsMock.render,
      cleanup: vi.fn(),
    }));
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: pdfjsMock.getPage,
      }),
      destroy: pdfjsMock.destroy,
    } as unknown as ReturnType<typeof getDocument>);

    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext() { return {
        fillStyle: "", fillRect: vi.fn(),
        getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      }; }
    });

  });

  it("depends on the patched PDF.js release", () => {
    expect(packageJson.dependencies["pdfjs-dist"]).toBe("6.3.289");
  });

  it("configures the pdf.js worker", () => {
    configurePdfWorker("/assets/pdf.worker.mjs");

    expect(GlobalWorkerOptions.workerSrc).toBe("/assets/pdf.worker.mjs");
  });

  it("decodes PDF pages to raster pages at the default DPI", async () => {
    const pages = await decodePdfBytes(new Uint8Array([1, 2, 3]), "sample.pdf");

    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: new Uint8Array([1, 2, 3]), useWorkerFetch: false }));
    expect(pdfjsMock.getPage).toHaveBeenCalledTimes(2);
    expect(pdfjsMock.render).toHaveBeenCalledTimes(2);
    expect(pdfjsMock.destroy).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      sourceName: "sample.pdf",
      pageIndex: 0,
      pageNumber: 1,
      pageCount: 2,
      width: 300,
      height: 600,
      xResolution: DEFAULT_PDF_RASTER_DPI,
      yResolution: DEFAULT_PDF_RASTER_DPI,
    });
    expect(pages[0].pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(pages[0].pixels).toHaveLength(300 * 600 * 4);
    expect(pages[1]).toMatchObject({
      sourceName: "sample.pdf",
      pageIndex: 1,
      pageNumber: 2,
      pageCount: 2,
      width: 600,
      height: 1200,
      xResolution: DEFAULT_PDF_RASTER_DPI,
      yResolution: DEFAULT_PDF_RASTER_DPI,
    });
    expect(pages[1].pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(pages[1].pixels).toHaveLength(600 * 1200 * 4);
  });

  it("uses custom DPI and worker source when provided", async () => {
    const pages = await decodePdfBytes(new Uint8Array([1]), "sample.pdf", {
      dpi: 150,
      workerSrc: "/assets/pdf.worker.mjs",
    });

    expect(GlobalWorkerOptions.workerSrc).toBe("/assets/pdf.worker.mjs");
    expect(pages[0]).toMatchObject({
      width: 150,
      height: 300,
      xResolution: 150,
      yResolution: 150,
    });
  });

  it("destroys the loading task when PDF loading fails", async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.reject(new Error("Invalid PDF")),
      destroy: pdfjsMock.destroy,
    } as unknown as ReturnType<typeof getDocument>);

    await expect(decodePdfBytes(new Uint8Array([1]), "invalid.pdf"))
      .rejects.toThrow("Invalid PDF");
    expect(pdfjsMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid DPI", async () => {
    await expect(decodePdfBytes(new Uint8Array([1]), "sample.pdf", { dpi: 0 }))
      .rejects.toThrow("PDF decoder: DPI must be a positive number.");
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("rejects an empty worker source", () => {
    expect(() => configurePdfWorker(" ")).toThrow("PDF decoder: worker source must not be empty.");
  });

  it("counts without rendering and releases the PDF task", async () => {
    const pageCount = vi.fn();
    await readPdfDocument(new Uint8Array([1]), "sample.pdf", defaultViewerConfig().view, { pageCount });
    expect(pageCount).toHaveBeenCalledWith(2);
    expect(pdfjsMock.getPage).not.toHaveBeenCalled();
    expect(pdfjsMock.destroy).toHaveBeenCalledOnce();
  });

  it.each(["bytes", "file", "count"] as const)("configures image decoder resources for the %s API", async (api) => {
    if (api === "bytes") {
      await decodePdfBytes(new Uint8Array([1]), "image.pdf");
    } else if (api === "file") {
      const file = new File([new Uint8Array([1])], "image.pdf");
      Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
      await decodePdfFile(file);
    } else {
      await readPdfDocument(new Uint8Array([1]), "image.pdf", defaultViewerConfig().view, { pageCount() {} });
    }

    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      BinaryDataFactory: expect.any(Function),
      useWasm: true,
      useWorkerFetch: false,
    }));
    expect(pdfjsMock.destroy).toHaveBeenCalledOnce();
  });

  it.each(["jbig2.wasm", "openjpeg.wasm"])("loads %s through the shared binary data factory", async (filename) => {
    const bytes = new Uint8Array([0, 97, 115, 109]);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    await readPdfDocument(new Uint8Array([1]), "image.pdf", defaultViewerConfig().view, { pageCount() {} });
    const { BinaryDataFactory } = vi.mocked(getDocument).mock.calls[0][0] as {
      BinaryDataFactory: new () => { fetch(input: { kind: string; filename: string }): Promise<Uint8Array> };
    };

    expect(await new BinaryDataFactory().fetch({ kind: "wasmUrl", filename })).toEqual(bytes);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a failed image decoder resource request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await readPdfDocument(new Uint8Array([1]), "image.pdf", defaultViewerConfig().view, { pageCount() {} });
    const { BinaryDataFactory } = vi.mocked(getDocument).mock.calls[0][0] as {
      BinaryDataFactory: new () => { fetch(input: { kind: string; filename: string }): Promise<Uint8Array> };
    };

    await expect(new BinaryDataFactory().fetch({ kind: "wasmUrl", filename: "jbig2.wasm" }))
      .rejects.toThrow("Could not load PDF resource: jbig2.wasm (404).");
  });

  it("caps shared PDF rendering by width, height and pixel budget", async () => {
    const pageReady = vi.fn();
    const raster = { pdfRasterDpi: 300, maxRasterWidth: 100, maxRasterHeight: 150, maxRasterPixels: 5000 };
    await readPdfDocument(new Uint8Array([1]), "sample.pdf", raster, { pageCount() {}, pageReady });
    for (const [page] of pageReady.mock.calls) {
      expect(page.width).toBeLessThanOrEqual(100);
      expect(page.height).toBeLessThanOrEqual(150);
      expect(page.width * page.height).toBeLessThanOrEqual(5000);
      expect(page.width).toBeGreaterThan(0);
      expect(page.xResolution).toBeLessThan(300);
    }
    expect(pageReady).toHaveBeenCalledTimes(2);
  });

  it("releases page and document resources after a rendering failure", async () => {
    const cleanup = vi.fn();
    pdfjsMock.getPage.mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({ width: 72 * scale, height: 144 * scale }),
      render() { throw new Error("render failed"); },
      cleanup,
    });
    await expect(decodePdfBytes(new Uint8Array([1]), "sample.pdf")).rejects.toThrow("render failed");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(pdfjsMock.destroy).toHaveBeenCalledOnce();
  });

  it("preserves the file API and passes its source name to the shared renderer", async () => {
    const file = new File([new Uint8Array([1, 2])], "file.pdf");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2]).buffer });
    const pages = await decodePdfFile(file, { dpi: 72 });
    expect(pages.map(page => page.sourceName)).toEqual(["file.pdf", "file.pdf"]);
    expect(pages[0]).toMatchObject({ width: 72, height: 144, xResolution: 72 });
  });
});
