import type { MetadataIndex, PageInfo, ViewerState, ViewerStatus, SelectionColor, ViewerConfig } from "@tabularium/aurora-lens";

export interface ViewerDetails {
  source: string;
  page: string;
  size: string;
  zoom: string;
  info: PageInfo | null;
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

export type { MetadataIndex, PageInfo, ViewerState, ViewerStatus, SelectionColor, ViewerConfig };
