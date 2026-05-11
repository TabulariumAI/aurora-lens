import type { ViewerState, ViewerStatus, SelectionColor } from "@tabularium/aurora-lens";

export interface ViewerDetails {
  source: string;
  page: string;
  size: string;
  zoom: string;
  tokens: string;
  figures: string;
  context: string;
  theme: {
    context: SelectionColor;
    figure: SelectionColor;
    tokenHigh: SelectionColor;
    tokenMedium: SelectionColor;
    tokenLow: SelectionColor;
    confidence: {
      high: string;
      medium: string;
      low: string;
    };
  };
}

export type HostViewerStatus = "empty" | "loading" | "ready";

export type { ViewerState, ViewerStatus, SelectionColor };
