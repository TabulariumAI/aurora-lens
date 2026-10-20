import type { PdfRasterPage } from "./types";
export type { PdfRasterPage } from "./types";
import { GlobalWorkerOptions } from "pdfjs-dist";
import { DEFAULT_EXPORT_CONFIG } from "../config/viewerConfig";
import { readPdfDocument } from "./pdfDocument";

export const DEFAULT_PDF_RASTER_DPI = 300;

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

  const pages: PdfRasterPage[] = [];
  await readPdfDocument(bytes, sourceName, { ...DEFAULT_EXPORT_CONFIG, pdfRasterDpi: dpi }, {
    pageCount() {},
    pageReady(page) { pages.push(page); },
  });
  return pages;
}

function normalizeDpi(dpi = DEFAULT_PDF_RASTER_DPI) {
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new Error("PDF decoder: DPI must be a positive number.");
  }
  return dpi;
}
