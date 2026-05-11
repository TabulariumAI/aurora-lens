export type ViewerIconName =
  | "search"
  | "zoom-out"
  | "zoom-in"
  | "fit-width"
  | "fit-height"
  | "fit"
  | "actual-size"
  | "thumbnails"
  | "rect"
  | "clear"
  | "copy"
  | "check"
  | "first"
  | "prev"
  | "next"
  | "last";

interface ViewerIconProps {
  name: ViewerIconName;
}

export function ViewerIcon({ name }: ViewerIconProps) {
  const elements = iconElements(name);
  return (
    <svg className="viewer-icon" viewBox="0 0 24 24" aria-hidden="true">
      {elements.map((element, index) => renderElement(element, index))}
    </svg>
  );
}

type IconElement =
  | { type: "path"; d: string }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "rect"; x: number; y: number; width: number; height: number; rx?: number }
  | { type: "circle"; cx: number; cy: number; r: number };

function renderElement(element: IconElement, index: number) {
  if (element.type === "path") {
    return <path key={index} d={element.d} />;
  }
  if (element.type === "line") {
    return <line key={index} x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2} />;
  }
  if (element.type === "rect") {
    return <rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} rx={element.rx ?? 2} />;
  }
  return <circle key={index} cx={element.cx} cy={element.cy} r={element.r} />;
}

function iconElements(name: ViewerIconName): IconElement[] {
  switch (name) {
    case "search":
      return [circle(10, 10, 5), line(14, 14, 20, 20)];
    case "zoom-out":
      return [circle(10, 10, 5), line(7, 10, 13, 10), line(14, 14, 20, 20)];
    case "zoom-in":
      return [circle(10, 10, 5), line(7, 10, 13, 10), line(10, 7, 10, 13), line(14, 14, 20, 20)];
    case "fit-width":
      return [rect(4, 6, 16, 12), line(7, 12, 17, 12), path("M8 9l-3 3 3 3"), path("M16 9l3 3-3 3")];
    case "fit-height":
      return [rect(6, 4, 12, 16), line(12, 7, 12, 17), path("M9 8l3-3 3 3"), path("M9 16l3 3 3-3")];
    case "fit":
      return [rect(5, 5, 14, 14), path("M8 10V8h2"), path("M16 10V8h-2"), path("M8 14v2h2"), path("M16 14v2h-2")];
    case "actual-size":
      return [rect(5, 5, 14, 14), path("M9 9h3v6"), path("M9 15h6")];
    case "thumbnails":
      return [rect(4, 4, 6, 6, 1), rect(14, 4, 6, 6, 1), rect(4, 14, 6, 6, 1), rect(14, 14, 6, 6, 1)];
    case "rect":
      return [rect(5, 6, 14, 12), path("M9 6V4"), path("M15 20v-2")];
    case "clear":
      return [path("M6 6l12 12"), path("M18 6L6 18")];
    case "copy":
      return [rect(8, 8, 10, 12), path("M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1")];
    case "check":
      return [path("M20 6L9 17l-5-5")];
    case "first":
      return [line(6, 5, 6, 19), path("M18 6l-8 6 8 6")];
    case "prev":
      return [path("M15 6l-8 6 8 6")];
    case "next":
      return [path("M9 6l8 6-8 6")];
    case "last":
      return [line(18, 5, 18, 19), path("M6 6l8 6-8 6")];
  }
}

function path(d: string): IconElement {
  return { type: "path", d };
}

function line(x1: number, y1: number, x2: number, y2: number): IconElement {
  return { type: "line", x1, y1, x2, y2 };
}

function rect(x: number, y: number, width: number, height: number, rx = 2): IconElement {
  return { type: "rect", x, y, width, height, rx };
}

function circle(cx: number, cy: number, r: number): IconElement {
  return { type: "circle", cx, cy, r };
}
