import { PolygonElement } from "./PolygonElement";
import type { PageFigure, SelectionTheme } from "./types";

export class FigureElement extends PolygonElement {
  constructor(figure: PageFigure, theme: SelectionTheme) {
    super(figure.polygon, theme.figure.fill, "source-over", { left: 0.35, top: 0.35, right: 0.35, bottom: 0.35 }, theme.figure.stroke);
  }
}
