export function assertContainer(container: HTMLElement) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("AuroraLens: container must be an HTMLElement.");
  }
}

export function assertDecoder(decoder: unknown) {
  if (
    typeof decoder !== "object" ||
    decoder === null ||
    typeof (decoder as { decode?: unknown }).decode !== "function" ||
    typeof (decoder as { thumbnail?: unknown }).thumbnail !== "function"
  ) {
    throw new Error("AuroraLens: decoder must implement decode and thumbnail.");
  }
}

export function assertFile(file: File) {
  if (!(file instanceof File)) {
    throw new Error("AuroraLens.decodeTiff: file must be a File.");
  }
}

export function assertPageIndex(pageIndex: number) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new Error("AuroraLens.decodeTiff: pageIndex must be a non-negative integer.");
  }
}
