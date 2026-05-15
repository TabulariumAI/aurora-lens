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

export function assertPageIndex(pageIndex: number) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new Error("AuroraLens.decodeDoc: pageIndex must be a non-negative integer.");
  }
}
