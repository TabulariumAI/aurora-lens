import type { ExportConfig } from "../config/viewerConfig";
import type { LensErrorCode } from "../errors/LensError";
import type { ViewerPageBlobRecord } from "../session/viewerSessionStore";

export type ExportProgress = {
  phase: "pages" | "finalizing";
  completed: number;
  total: number;
};

export type ExportRequest = {
  pages: ViewerPageBlobRecord[];
  config: ExportConfig;
};

export type ExportResponse =
  | { kind: "progress"; progress: ExportProgress }
  | { kind: "done"; blob: Blob }
  | { kind: "error"; errorCode: LensErrorCode; error: string };
