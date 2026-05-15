import "pdfjs-dist/build/pdf.worker.mjs";
import { getDocument } from "pdfjs-dist";
import {
  LENS_ERROR_EMPTY_DOCUMENT,
  LENS_ERROR_UNKNOWN,
  LENS_ERROR_UNREADABLE_DOCUMENT,
  LensError,
  type LensErrorCode,
} from "../../errors/LensError";
import type { DecodeRequest, DecodeResponse, DecodedPage } from "../types";

const PDF_POINTS_PER_INCH = 72;

class WorkerCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder canvas size is invalid.");
    }
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: true }),
    };
  }

  reset(canvasAndContext: { canvas: OffscreenCanvas | null }, width: number, height: number): void {
    if (!canvasAndContext.canvas || width <= 0 || height <= 0) {
      throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder canvas size is invalid.");
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }): void {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    }
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

class WorkerFilterFactory {
  addFilter(): string {
    return "none";
  }

  addHCMFilter(): string {
    return "none";
  }

  addAlphaFilter(): string {
    return "none";
  }

  addLuminosityFilter(): string {
    return "none";
  }

  addHighlightHCMFilter(): string {
    return "none";
  }

  destroy(): void {
    return;
  }
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  void decode(event.data).catch((reason: unknown) => {
    workerScope.postMessage({
      id: event.data.id,
      kind: "error",
      errorCode: errorCode(reason),
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
};

async function decode(request: DecodeRequest): Promise<void> {
  const documents = await Promise.all(request.files.map(async (file) => {
    const pdf = await getDocument({
      data: new Uint8Array(file.buffer).slice(),
      CanvasFactory: WorkerCanvasFactory,
      FilterFactory: WorkerFilterFactory,
      disableFontFace: true,
    }).promise;
    if (pdf.numPages <= 0) {
      throw new LensError(LENS_ERROR_EMPTY_DOCUMENT, "The selected file does not contain readable pages.");
    }
    return { file, pdf };
  }));

  post({
    id: request.id,
    kind: "pageCount",
    pageCount: documents.reduce((sum, document) => sum + document.pdf.numPages, 0),
  });
  if (request.operation === "count") {
    await Promise.all(documents.map((document) => document.pdf.destroy()));
    post({ id: request.id, kind: "done" });
    return;
  }

  let importIndex = 0;
  try {
    for (const document of documents) {
      for (let pageNumber = 1; pageNumber <= document.pdf.numPages; pageNumber += 1) {
        const pdfPage = await document.pdf.getPage(pageNumber);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = renderScale(baseViewport.width, baseViewport.height, request);
        const viewport = pdfPage.getViewport({ scale });
        const width = rasterSize(viewport.width);
        const height = rasterSize(viewport.height);
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) {
          throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder canvas is unavailable.");
        }
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({
          canvas: null,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
          background: "rgb(255,255,255)",
        }).promise;
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const page: DecodedPage = {
          sourceName: document.file.sourceName,
          sourceType: document.file.sourceType,
          pageIndex: pageNumber - 1,
          pageNumber,
          pageCount: document.pdf.numPages,
          width: canvas.width,
          height: canvas.height,
          pixels: new Uint8ClampedArray(imageData.data),
          xResolution: scale * PDF_POINTS_PER_INCH,
          yResolution: scale * PDF_POINTS_PER_INCH,
        };
        post({ id: request.id, kind: "pageReady", importIndex, page }, [page.pixels.buffer]);
        importIndex += 1;
      }
    }
  } finally {
    await Promise.all(documents.map((document) => document.pdf.destroy()));
  }

  post({ id: request.id, kind: "done" });
}

function post(response: DecodeResponse, transfer?: Transferable[]) {
  workerScope.postMessage(response, transfer);
}

function renderScale(width: number, height: number, request: DecodeRequest): number {
  const dpiScale = request.raster.pdfRasterDpi / PDF_POINTS_PER_INCH;
  const dpiWidth = width * dpiScale;
  const dpiHeight = height * dpiScale;
  const pixelScale = Math.sqrt(request.raster.maxRasterPixels / (dpiWidth * dpiHeight));
  const capScale = Math.min(
    1,
    request.raster.maxRasterWidth / dpiWidth,
    request.raster.maxRasterHeight / dpiHeight,
    pixelScale
  );
  const scale = dpiScale * capScale;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder raster scale is invalid.");
  }
  return scale;
}

function rasterSize(value: number): number {
  const size = Math.floor(value);
  if (!Number.isFinite(size) || size <= 0) {
    throw new LensError(LENS_ERROR_UNREADABLE_DOCUMENT, "PDF decoder raster size is invalid.");
  }
  return size;
}

function errorCode(error: unknown): LensErrorCode {
  return error instanceof LensError ? error.code : LENS_ERROR_UNKNOWN;
}
