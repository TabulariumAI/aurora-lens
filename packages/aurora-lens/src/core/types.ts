export type ViewMode = "page" | "thumbnails";

export type ViewerStatus =
  | "idle"
  | "loadingPage"
  | "loadingThumbnails"
  | "copyingSelection"
  | "ready"
  | "error";

export interface PagePoint {
  x: number;
  y: number;
}

export interface PageRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SelectionCounts {
  tokens: number;
  figures: number;
  context: number;
}

export interface SelectionColor {
  fill: string;
  stroke: string;
}

export interface SelectionTheme {
  context: SelectionColor;
  figure: SelectionColor;
  token: {
    high: SelectionColor;
    medium: SelectionColor;
    low: SelectionColor;
  };
  confidence: {
    high: number;
    medium: number;
  };
}

export interface PartialSelectionTheme {
  context?: Partial<SelectionColor>;
  figure?: Partial<SelectionColor>;
  token?: {
    high?: Partial<SelectionColor>;
    medium?: Partial<SelectionColor>;
    low?: Partial<SelectionColor>;
  };
  confidence?: {
    high?: number;
    medium?: number;
  };
}

export interface ViewerState {
  viewMode: ViewMode;
  status: ViewerStatus;
  sourceName: string | null;
  pageIndex: number;
  pageCount: number;
  pageWidth: number | null;
  pageHeight: number | null;
  zoom: number;
  coordinates: PagePoint | null;
  displayCoordinates: PagePoint | null;
  selectionCounts: SelectionCounts;
  drawMode: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  canFitWidth: boolean;
  canFitHeight: boolean;
  canFitPage: boolean;
  canActualSize: boolean;
  canGoFirst: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canGoLast: boolean;
  canShowThumbnails: boolean;
  canSearch: boolean;
  canDraw: boolean;
  canClearSelection: boolean;
  canCopy: boolean;
}

export interface ViewerDecoder {
  decode(file: File, pageIndex: number): Promise<RasterPage>;
  thumbnail(file: File, pageIndex: number, maxSize: number): Promise<RasterPage>;
  close?(): void;
}

export interface ViewerOptions {
  decoder: ViewerDecoder;
  selectionTheme?: PartialSelectionTheme;
  onStateChange?: (state: ViewerState) => void;
  onStatusChange?: (status: ViewerStatus) => void;
  onThumbnailSelect?: (pageIndex: number) => void;
  onError?: (error: Error) => void;
}

export interface SelectedGroup {
  value: {
    token: Array<string | null>;
    context: Array<string | null>;
    kind: string[];
  };
}

export interface CopySelectionResult {
  copied: boolean;
  groups: SelectedGroup[];
  text: string;
}

export interface PageToken {
  token: string | null;
  confidence: string;
  polygon: number[];
}

export interface PageContext {
  role?: string;
  content: string | null;
  polygon: number[];
}

export interface PageFigure {
  polygon: number[];
}

export interface PageMetadataHits {
  tokens: PageToken[];
  contexts: PageContext[];
  figures: PageFigure[];
}

export interface DecodedPage {
  sourceName: string;
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  url: string;
}

export interface ThumbnailPage {
  sourceName: string;
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  url: string;
}

export interface RasterPage {
  sourceName: string;
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
}
