import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

const PDF_POINTS_PER_INCH = 72;
export const DEFAULT_PDF_RASTER_DPI = 300;

export interface PdfRasterPage {
  sourceName: string;
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  xResolution: number;
  yResolution: number;
}

export interface PdfDecodeOptions {
  dpi?: number;
  workerSrc?: string;
}

export function configurePdfWorker(workerSrc: string): void {
  if (!workerSrc.trim()) {
    throw new Error("PDF decoder: worker source must not be empty.");
  }
  GlobalWorkerOptions.workerSrc = workerSrc;
}

export async function decodePdfFile(file: File, options: PdfDecodeOptions = {}): Promise<PdfRasterPage[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodePdfBytes(bytes, file.name, options);
}

export async function decodePdfBytes(bytes: Uint8Array, sourceName: string, options: PdfDecodeOptions = {}): Promise<PdfRasterPage[]> {
  const dpi = normalizeDpi(options.dpi);
  if (options.workerSrc !== undefined) {
    configurePdfWorker(options.workerSrc);
  }

  const pdf = await getDocument({ data: bytes.slice() }).promise;

  try {
    const pages: PdfRasterPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: dpi / PDF_POINTS_PER_INCH });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("PDF decoder: canvas 2D context is not available.");
      }

      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas,
        viewport,
        background: "rgb(255,255,255)",
      }).promise;

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      pages.push({
        sourceName,
        pageIndex: pageNumber - 1,
        pageNumber,
        pageCount: pdf.numPages,
        width: canvas.width,
        height: canvas.height,
        pixels: new Uint8ClampedArray(imageData.data),
        xResolution: dpi,
        yResolution: dpi,
      });
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

function normalizeDpi(dpi = DEFAULT_PDF_RASTER_DPI) {
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new Error("PDF decoder: DPI must be a positive number.");
  }
  return dpi;
}
