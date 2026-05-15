import { PolygonElement } from "./PolygonElement";
import type { PageContext, SelectionTheme } from "../types";

export class ContextElement extends PolygonElement {
  constructor(context: PageContext, theme: SelectionTheme) {
    super(context.polygon, theme.context.fill, "multiply", { left: 0.35, top: 0.35, right: 0.35, bottom: 0.35 }, theme.context.stroke);
  }
}
