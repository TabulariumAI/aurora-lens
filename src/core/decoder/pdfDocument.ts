import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { RasterConfig } from "../config/viewerConfig";
import { LENS_ERROR_EMPTY_DOCUMENT, LENS_ERROR_UNREADABLE_DOCUMENT, LensError } from "../errors/LensError";
import type { PdfRasterPage } from "./types";

const PDF_POINTS_PER_INCH = 72;
GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).toString();

class PdfCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(target: { canvas: OffscreenCanvas }, width: number, height: number) {
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }) {
    if (target.canvas) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

// Offscreen rendering has no DOM in which to install PDF.js SVG filters.
class PdfFilterFactory {
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  destroy() {}
}

class PdfBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    let url: URL;
    switch (kind) {
      case "standardFontDataUrl":
        url = new URL(`./vendor/pdfjs-standard-fonts/${filename}`, import.meta.url);
        break;
      case "wasmUrl":
        url = new URL(`./vendor/pdfjs-wasm/${filename}`, import.meta.url);
        break;
      default:
        throw new Error(`Unsupported PDF resource kind: ${kind}`);
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load PDF resource: ${filename} (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

interface PdfSink {
  pageCount(count: number): Promise<void> | void;
  pageReady?: (page: PdfRasterPage) => Promise<void> | void;
}

export async function readPdfDocument(bytes: Uint8Array, sourceName: string, raster: RasterConfig, sink: PdfSink): Promise<void> {
  const loadingTask = getDocument({
    data: bytes.slice(),
    CanvasFactory: PdfCanvasFactory,
    FilterFactory: PdfFilterFactory,
    BinaryDataFactory: PdfBinaryDataFactory,
    disableFontFace: true,
    useSystemFonts: true,
    useWasm: true,
    useWorkerFetch: false,
  });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages <= 0) throw new LensError(LENS_ERROR_EMPTY_DOCUMENT, "The selected file does not contain readable pages.");
    await sink.pageCount(pdf.numPages);
    if (!sink.pageReady) return;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        raster.pdfRasterDpi / PDF_POINTS_PER_INCH,
        raster.maxRasterWidth / base.width,
        raster.maxRasterHeight / base.height,
        Math.sqrt(raster.maxRasterPixels / (base.width * base.height)),
      );
      const viewport = page.getViewport({ scale });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      if (!Number.isFinite(scale) || scale <= 0 || width <= 0 || height <= 0) {
        throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder raster size is invalid.");
      }
      const canvas = new OffscreenCanvas(width, height);
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder canvas is unavailable.");
        context.fillStyle = "white";
        context.fillRect(0, 0, width, height);
        await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, background: "rgb(255,255,255)" }).promise;
        const imageData = context.getImageData(0, 0, width, height);
        await sink.pageReady({
          sourceName, pageIndex: pageNumber - 1, pageNumber, pageCount: pdf.numPages,
          width, height, pixels: imageData.data,
          xResolution: scale * PDF_POINTS_PER_INCH, yResolution: scale * PDF_POINTS_PER_INCH,
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }
}
