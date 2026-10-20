import { LENS_ERROR_UNKNOWN, LensError } from "../errors/LensError";
import type { ExportConfig } from "../config/viewerConfig";
import type { ViewerPageBlobRecord } from "../session/viewerSessionStore";
import type { ExportProgress, ExportResponse } from "./types";

export class TiffExporter {
  private readonly pending = new Map<Worker, (error: Error) => void>();

  async export(pages: ViewerPageBlobRecord[], config: ExportConfig, onProgress?: (progress: ExportProgress) => void): Promise<Blob> {
    const worker = new Worker(new URL("./workers/tiffExportWorker.js", import.meta.url), { type: "module" });
    try {
      return await new Promise<Blob>((resolve, reject) => {
        this.pending.set(worker, reject);
        worker.onmessage = (event: MessageEvent<ExportResponse>) => {
          const response = event.data;
          try {
            if (response.kind === "progress") onProgress?.(response.progress);
            else if (response.kind === "done") resolve(response.blob);
            else reject(new LensError(response.errorCode, response.error));
          } catch (error) {
            reject(error);
          }
        };
        worker.onerror = (event) => reject(new LensError(LENS_ERROR_UNKNOWN, event.message));
        worker.onmessageerror = () => reject(new LensError(LENS_ERROR_UNKNOWN, "TIFF export worker returned an unreadable response."));
        worker.postMessage({ pages, config });
      });
    } finally {
      this.pending.delete(worker);
      worker.terminate();
    }
  }

  close(): void {
    for (const reject of this.pending.values()) {
      reject(new DOMException("TIFF export closed.", "AbortError"));
    }
  }
}
