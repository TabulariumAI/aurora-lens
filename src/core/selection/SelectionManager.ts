import { hitPoly } from "../geometry";
import { ContextElement } from "./ContextElement";
import { FigureElement } from "./FigureElement";
import { TokenElement } from "./TokenElement";
import type { PageFigure, PageMetadataHits, PagePoint, PageToken, SelectionCounts, SelectionTheme } from "../types";

interface TokenHit {
  key: string;
  token: PageToken;
  contextKeys: string[];
}

interface ContextHit {
  element: ContextElement;
  count: number;
}

export class SelectionManager {
  private selectedTokens = new Map<string, TokenHit>();
  private selectedFigures = new Map<string, { figure: PageFigure; element: FigureElement }>();
  private selectedContexts = new Map<string, ContextHit>();

  constructor(private readonly theme: SelectionTheme) {}

  hasTokens() {
    return this.selectedTokens.size > 0;
  }

  tokens() {
    return Array.from(this.selectedTokens.values()).map((hit) => hit.token);
  }

  counts(): SelectionCounts {
    return {
      tokens: this.selectedTokens.size,
      figures: this.selectedFigures.size,
      context: this.selectedContexts.size,
    };
  }

  clearElement(point: PagePoint) {
    if (this.removeAt(point)) {
      return { type: "handled" as const };
    }
    return {
      type: "load" as const,
      point,
    };
  }

  showElement(hits: PageMetadataHits) {
    this.clear();
    this.addHits(hits);
  }

  showElements(hits: PageMetadataHits) {
    this.addHits(hits);
  }

  isSelected(hits: PageMetadataHits) {
    return hits.tokens.every(token => this.selectedTokens.has(this.tokenKey(token))) &&
      hits.figures.every(figure => this.selectedFigures.has(this.figureKey(figure)));
  }

  toggle(hits: PageMetadataHits) {
    if (this.isSelected(hits)) {
      hits.tokens.forEach(token => this.removeHit(this.selectedTokens.get(this.tokenKey(token))!));
      hits.figures.forEach(figure => this.selectedFigures.delete(this.figureKey(figure)));
    } else {
      this.addHits(hits);
    }
  }

  clear() {
    this.selectedTokens = new Map();
    this.selectedFigures = new Map();
    this.selectedContexts = new Map();
  }

  draw(context: CanvasRenderingContext2D, page: { width: number; height: number }, image: DOMRect, frame: DOMRect) {
    const contextElements = Array.from(this.selectedContexts.values()).map((item) => item.element);
    if (contextElements.length) {
      context.save();
      context.beginPath();
      contextElements.forEach((element) => element.addPath(context, page, image, frame));
      if (this.theme.context.fill) {
        context.fillStyle = this.theme.context.fill;
        context.globalCompositeOperation = "multiply";
        context.fill();
      }
      if (this.theme.context.stroke) {
        context.globalCompositeOperation = "source-over";
        context.strokeStyle = this.theme.context.stroke;
        context.lineWidth = 2;
        context.stroke();
      }
      context.restore();
    }
    this.selectedFigures.forEach((hit) => hit.element.draw(context, page, image, frame));
    this.selectedTokens.forEach((hit) => new TokenElement(hit.token, this.theme).draw(context, page, image, frame));
  }

  private addHits(hits: PageMetadataHits) {
    hits.tokens.forEach((token) => {
      this.addToken(token, hits.contexts);
    });
    if (!hits.tokens.length) {
      hits.contexts.forEach((context) => {
        this.addContext(this.polygonKey("c", context.polygon), new ContextElement(context, this.theme));
      });
    }
    hits.figures.forEach((figure) => {
      this.addFigure(figure);
    });
  }

  private addToken(token: PageToken, contexts: PageMetadataHits["contexts"]) {
    const key = this.tokenKey(token);
    if (this.selectedTokens.has(key)) {
      return;
    }
    const hit: TokenHit = {
      key,
      token,
      contextKeys: [],
    };
    contexts.forEach((context) => {
      hit.contextKeys.push(this.addContext(this.polygonKey("c", context.polygon), new ContextElement(context, this.theme)));
    });
    this.selectedTokens.set(key, hit);
  }

  private addFigure(figure: PageFigure) {
    const key = this.figureKey(figure);
    if (!this.selectedFigures.has(key)) {
      this.selectedFigures.set(key, {
        figure,
        element: new FigureElement(figure, this.theme),
      });
    }
  }

  private addContext(key: string, element: ContextElement) {
    const current = this.selectedContexts.get(key);
    if (current) {
      current.count += 1;
    } else {
      this.selectedContexts.set(key, {
        element,
        count: 1,
      });
    }
    return key;
  }

  private removeHit(hit: TokenHit) {
    hit.contextKeys.forEach((key) => {
      const current = this.selectedContexts.get(key)!;
      current.count -= 1;
      if (current.count === 0) {
        this.selectedContexts.delete(key);
      }
    });
    this.selectedTokens.delete(hit.key);
  }

  private removeAt(point: PagePoint) {
    for (const hit of this.selectedTokens.values()) {
      if (hitPoly(hit.token.polygon, point.x, point.y)) {
        this.removeHit(hit);
        return true;
      }
    }
    for (const [key, hit] of this.selectedFigures) {
      if (hitPoly(hit.figure.polygon, point.x, point.y)) {
        this.selectedFigures.delete(key);
        return true;
      }
    }
    return false;
  }

  private tokenKey(token: PageToken) {
    return `${token.token}\n${token.polygon.join(",")}`;
  }

  private figureKey(figure: PageFigure) {
    return this.polygonKey("f", figure.polygon);
  }

  private polygonKey(type: string, polygon: number[]) {
    return `${type}\n${polygon.join(",")}`;
  }

}
