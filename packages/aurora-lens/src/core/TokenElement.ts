import { PolygonElement } from "./PolygonElement";
import { tokenStyle } from "./selectionTheme";
import type { PageToken, SelectionTheme } from "./types";

export class TokenElement extends PolygonElement {
  constructor(token: PageToken, theme: SelectionTheme) {
    const style = tokenStyle(token.confidence, theme);
    super(token.polygon, style.fill, "source-over", { left: 0.35, top: 0.35, right: 0.35, bottom: 0.35 }, style.stroke);
  }
}
