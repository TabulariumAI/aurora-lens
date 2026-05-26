import type { DecodeDocOptions, ViewMode } from "../types";

export function assertContainer(container: HTMLElement) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("AuroraLens: container must be an HTMLElement.");
  }
}

export function assertFile(file: File) {
  if (!(file instanceof File)) {
    throw new Error("AuroraLens.decodeDoc: file must be a File.");
  }
}

export function assertDecodeOptions(options: DecodeDocOptions) {
  if (!options || typeof options !== "object") {
    throw new Error("AuroraLens.decodeDoc: options must include page and viewMode.");
  }
}

export function assertPageIndex(pageIndex: number) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new Error("AuroraLens.decodeDoc: page must be a non-negative integer.");
  }
}

export function assertViewMode(viewMode: ViewMode) {
  if (viewMode !== "page" && viewMode !== "thumbnails") {
    throw new Error("AuroraLens.decodeDoc: viewMode must be page or thumbnails.");
  }
}
