import type { PagePoint } from "../types";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function screenToPage(
  clientX: number,
  clientY: number,
  image: Box,
  pageWidth: number,
  pageHeight: number,
  requireInside: boolean
): PagePoint | null {
  if (image.width <= 0 || image.height <= 0) {
    return null;
  }
  const insideX = clientX >= image.left && clientX <= image.left + image.width;
  const insideY = clientY >= image.top && clientY <= image.top + image.height;
  if (requireInside && (!insideX || !insideY)) {
    return null;
  }
  return {
    x: Math.trunc(clamp(((clientX - image.left) / image.width) * pageWidth, 0, pageWidth - 1)),
    y: Math.trunc(clamp(((clientY - image.top) / image.height) * pageHeight, 0, pageHeight - 1)),
  };
}

export function screenToDisplay(clientX: number, clientY: number, image: Box, requireInside: boolean): PagePoint | null {
  if (image.width <= 0 || image.height <= 0) {
    return null;
  }
  const insideX = clientX >= image.left && clientX <= image.left + image.width;
  const insideY = clientY >= image.top && clientY <= image.top + image.height;
  if (requireInside && (!insideX || !insideY)) {
    return null;
  }
  return {
    x: Math.trunc(clamp(clientX - image.left, 0, image.width - 1)),
    y: Math.trunc(clamp(clientY - image.top, 0, image.height - 1)),
  };
}

export function pageRect(start: PagePoint, end: PagePoint, pageWidth: number, pageHeight: number) {
  const x1 = Math.trunc(clamp(start.x, 0, pageWidth - 1));
  const y1 = Math.trunc(clamp(start.y, 0, pageHeight - 1));
  const x2 = Math.trunc(clamp(end.x, 0, pageWidth - 1));
  const y2 = Math.trunc(clamp(end.y, 0, pageHeight - 1));
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
