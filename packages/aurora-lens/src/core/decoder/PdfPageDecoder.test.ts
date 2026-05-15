import { beforeEach, describe, expect, it, vi } from "vitest";

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
  DEFAULT_PDF_RASTER_DPI,
} = await import("./PdfPageDecoder");

describe("PdfPageDecoder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfjsMock.GlobalWorkerOptions.workerSrc = "";
    pdfjsMock.getPage.mockImplementation((pageNumber: number) => Promise.resolve({
      getViewport: ({ scale }: { scale: number }) => ({
        width: pageNumber * 72 * scale,
        height: pageNumber * 144 * scale,
      }),
      render: pdfjsMock.render,
    }));
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: pdfjsMock.getPage,
        destroy: pdfjsMock.destroy,
      }),
    } as unknown as ReturnType<typeof getDocument>);

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        fillStyle: "",
        fillRect: vi.fn(),
        getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
      })),
    });
  });

  it("configures the pdf.js worker", () => {
    configurePdfWorker("/assets/pdf.worker.mjs");

    expect(GlobalWorkerOptions.workerSrc).toBe("/assets/pdf.worker.mjs");
  });

  it("decodes PDF pages to raster pages at the default DPI", async () => {
    const pages = await decodePdfBytes(new Uint8Array([1, 2, 3]), "sample.pdf");

    expect(getDocument).toHaveBeenCalledWith({ data: new Uint8Array([1, 2, 3]) });
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

  it("rejects invalid DPI", async () => {
    await expect(decodePdfBytes(new Uint8Array([1]), "sample.pdf", { dpi: 0 }))
      .rejects.toThrow("PDF decoder: DPI must be a positive number.");
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("rejects an empty worker source", () => {
    expect(() => configurePdfWorker(" ")).toThrow("PDF decoder: worker source must not be empty.");
  });
});
