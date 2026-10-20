export function hitPoly(polygon: number[], x: number, y: number) {
  let inside = false;
  for (let index = 0, last = polygon.length - 2; index < polygon.length; last = index, index += 2) {
    const x1 = polygon[index];
    const y1 = polygon[index + 1];
    const x2 = polygon[last];
    const y2 = polygon[last + 1];
    if (onEdge(x, y, x1, y1, x2, y2)) {
      return true;
    }
    if ((y1 > y) !== (y2 > y) && x <= ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

export function onEdge(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
  return (
    (x - x1) * (y2 - y1) === (y - y1) * (x2 - x1) &&
    x >= Math.min(x1, x2) &&
    x <= Math.max(x1, x2) &&
    y >= Math.min(y1, y2) &&
    y <= Math.max(y1, y2)
  );
}

