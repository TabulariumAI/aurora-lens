import Fuse from "fuse.js";
import { MetadataRepository } from "./MetadataRepository";
import type { PageContext, PageFigure, PageMetadataHits, PageToken, SelectedGroup } from "./types";

const rectTolerance = 5;

interface MetadataRoot {
  pages: PageData[];
}

interface PageData {
  pageNumber: number;
  width: number;
  height: number;
  tokens: Array<{
    content?: string;
    confidence: number;
    polygon: number[];
  }>;
  contexts: Array<{
    role?: string;
    content?: string;
    polygon: number[];
  }>;
  figures: Array<{
    polygon: number[];
  }>;
}

interface TokenItem {
  token: string | null;
  polygon: number[];
  value: PageToken;
}

interface SearchToken extends TokenItem {
  score: number;
}

export class MetadataHelper {
  private metadata: MetadataRoot | null = null;
  private readonly repository = new MetadataRepository();

  load(pageMetadata: unknown) {
    const metadata = pageMetadata as MetadataRoot;
    if (!Array.isArray(metadata.pages)) {
      throw new Error("AuroraLens.loadMetadata: metadata must include pages.");
    }
    this.metadata = metadata;
  }

  loadPage(pageIndex: number, pageMetadata: unknown) {
    this.load(this.repository.pageRoot(pageIndex, pageMetadata));
  }

  clear() {
    this.metadata = null;
  }

  hasPage(pageIndex: number) {
    return Boolean(this.metadata?.pages[pageIndex]);
  }

  pageCount() {
    return this.metadata?.pages.length ?? 0;
  }

  pageSize(pageIndex: number) {
    const page = this.page(pageIndex);
    return {
      width: page.width,
      height: page.height,
    };
  }

  getElement(pageIndex: number, x: number, y: number): PageMetadataHits {
    const page = this.page(pageIndex);
    const tokens = page.tokens
      .filter((token) => this.hitPoly(token.polygon, x, y))
      .map((token) => this.token(token));
    return {
      tokens,
      contexts: page.contexts
        .filter((context) => this.hitPoly(context.polygon, x, y))
        .filter((context) => !tokens.some((token) => this.containsPoly(token.polygon, context.polygon)))
        .map((context) => this.context(context)),
      figures: page.figures
        .filter((figure) => this.hitPoly(figure.polygon, x, y))
        .map((figure) => this.figure(figure)),
    };
  }

  getElements(pageIndex: number, x1: number, y1: number, x2: number, y2: number): PageMetadataHits {
    const page = this.page(pageIndex);
    const rect = this.rect(x1, y1, x2, y2);
    const tokenRect = this.expandRect(rect, rectTolerance);
    const tokens = this.tokenItems(pageIndex).filter((token) => this.inRectPoly(token.polygon, tokenRect));
    return {
      tokens: tokens.map((token) => token.value),
      contexts: this.contexts(page, tokens),
      figures: page.figures
        .filter((figure) => this.hitRect(figure.polygon, rect))
        .map((figure) => this.figure(figure)),
    };
  }

  search(pageIndex: number, text: string): PageMetadataHits {
    const value = text.trim();
    if (!value) {
      return {
        tokens: [],
        contexts: [],
        figures: [],
      };
    }
    const page = this.page(pageIndex);
    const tokens = this.searchTokens(pageIndex, value);
    return {
      tokens: tokens.map((token) => token.value),
      contexts: this.contexts(page, tokens),
      figures: [],
    };
  }

  exportGroups(pageIndex: number, tokens: PageToken[]): SelectedGroup[] {
    const page = this.page(pageIndex);
    const items = new Map(this.tokenItems(pageIndex).map((token) => [this.selectKey(token.value), token]));
    const groups = new Map<string | null, SelectedGroup>();
    tokens.forEach((token) => {
      const item = items.get(this.selectKey(token))!;
      this.contexts(page, [item]).forEach((context) => {
        const text = typeof context.content === "string" ? context.content.toUpperCase() : context.content;
        const kind = typeof context.role === "string" ? context.role.toUpperCase() : "BODY";
        const value = typeof token.token === "string" ? token.token.toUpperCase() : token.token;
        if (!groups.has(text)) {
          groups.set(text, {
            value: {
              token: [],
              context: [],
              kind: [],
            },
          });
        }
        const group = groups.get(text)!.value;
        if (!group.token.includes(value)) {
          group.token.push(value);
        }
        if (!group.context.includes(text)) {
          group.context.push(text);
        }
        if (!group.kind.includes(kind)) {
          group.kind.push(kind);
        }
      });
    });
    return Array.from(groups.values());
  }

  private searchTokens(pageIndex: number, text: string) {
    const items = this.tokenItems(pageIndex);
    const rawTerms = text
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term);
    const hasOr = rawTerms.some((term) => /^or$/i.test(term));
    const terms = rawTerms.filter((term) => !/^or$/i.test(term));
    if (!terms.length) {
      return [];
    }
    const matches = terms.map((term) => this.searchItems(items, term));
    if (hasOr) {
      return this.uniqueTokens(matches.flat());
    }
    if (matches.some((match) => !match.length)) {
      return [];
    }
    if (matches.length === 1) {
      return matches[0];
    }
    return this.contextTokens(pageIndex, matches);
  }

  private uniqueTokens(tokens: SearchToken[]) {
    const found = new Map<string, SearchToken>();
    tokens.forEach((token) => {
      found.set(this.selectKey(token.value), token);
    });
    return Array.from(found.values());
  }

  private contextTokens(pageIndex: number, matches: SearchToken[][]) {
    const tokens: SearchToken[] = [];
    this.page(pageIndex).contexts.forEach((context) => {
      const contextMatches = matches.map((match) => match.filter((token) => this.hitPoly(context.polygon, ...this.center(token.polygon))));
      if (contextMatches.some((match) => !match.length)) {
        return;
      }
      contextMatches.forEach((match) => {
        const score = Math.min.apply(
          null,
          match.map((token) => token.score)
        );
        match.filter((token) => token.score === score).forEach((token) => tokens.push(token));
      });
    });
    return this.uniqueTokens(tokens);
  }

  private selectKey(token: PageToken) {
    return `${token.token}\n${token.polygon.join(",")}`;
  }

  private tokenItems(pageIndex: number): TokenItem[] {
    return this.page(pageIndex).tokens.map((token) => ({
      token: token.content || null,
      polygon: token.polygon,
      value: this.token(token),
    }));
  }

  private token(token: { content?: string; confidence: number; polygon: number[] }): PageToken {
    return {
      confidence: `${Math.round(token.confidence * 100)}%`,
      token: token.content || null,
      polygon: token.polygon,
    };
  }

  private contexts(page: PageData, tokens: TokenItem[]): PageContext[] {
    return page.contexts
      .filter((context) => context.content)
      .filter((context) => tokens.some((token) => this.hitPoly(context.polygon, ...this.center(token.polygon))))
      .map((context) => this.context(context));
  }

  private context(context: { role?: string; content?: string; polygon: number[] }): PageContext {
    return {
      role: context.role,
      content: context.content || null,
      polygon: context.polygon,
    };
  }

  private figure(figure: { polygon: number[] }): PageFigure {
    return {
      polygon: figure.polygon,
    };
  }

  private searchItems(items: TokenItem[], text: string): SearchToken[] {
    return new Fuse(
      items.filter((item) => item.token),
      {
        keys: ["token"],
        threshold: 0.3,
        isCaseSensitive: false,
        includeScore: true,
      }
    ).search(text).map((match) => ({
      token: match.item.token,
      polygon: match.item.polygon,
      score: match.score!,
      value: match.item.value,
    }));
  }

  private rect(x1: number, y1: number, x2: number, y2: number) {
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      right: Math.max(x1, x2),
      bottom: Math.max(y1, y2),
    };
  }

  private expandRect(rect: { left: number; top: number; right: number; bottom: number }, value: number) {
    return {
      left: rect.left - value,
      top: rect.top - value,
      right: rect.right + value,
      bottom: rect.bottom + value,
    };
  }

  private center(polygon: number[]): [number, number] {
    const xs = [];
    const ys = [];
    for (let index = 0; index < polygon.length; index += 2) {
      xs.push(polygon[index]);
      ys.push(polygon[index + 1]);
    }
    return [
      (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2,
      (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2,
    ];
  }

  private containsPoly(polygon: number[], inner: number[]) {
    for (let index = 0; index < inner.length; index += 2) {
      if (!this.hitPoly(polygon, inner[index], inner[index + 1])) {
        return false;
      }
    }
    return true;
  }

  private hitRect(polygon: number[], rect: { left: number; top: number; right: number; bottom: number }) {
    for (let index = 0; index < polygon.length; index += 2) {
      if (this.inRect(polygon[index], polygon[index + 1], rect)) {
        return true;
      }
    }
    if (
      this.hitPoly(polygon, rect.left, rect.top) ||
      this.hitPoly(polygon, rect.right, rect.top) ||
      this.hitPoly(polygon, rect.right, rect.bottom) ||
      this.hitPoly(polygon, rect.left, rect.bottom)
    ) {
      return true;
    }
    for (let index = 0, last = polygon.length - 2; index < polygon.length; last = index, index += 2) {
      if (this.hitRectEdge(polygon[last], polygon[last + 1], polygon[index], polygon[index + 1], rect)) {
        return true;
      }
    }
    return false;
  }

  private inRect(x: number, y: number, rect: { left: number; top: number; right: number; bottom: number }) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  private inRectPoly(polygon: number[], rect: { left: number; top: number; right: number; bottom: number }) {
    for (let index = 0; index < polygon.length; index += 2) {
      if (!this.inRect(polygon[index], polygon[index + 1], rect)) {
        return false;
      }
    }
    return true;
  }

  private hitRectEdge(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rect: { left: number; top: number; right: number; bottom: number }
  ) {
    return (
      this.hitLine(x1, y1, x2, y2, rect.left, rect.top, rect.right, rect.top) ||
      this.hitLine(x1, y1, x2, y2, rect.right, rect.top, rect.right, rect.bottom) ||
      this.hitLine(x1, y1, x2, y2, rect.right, rect.bottom, rect.left, rect.bottom) ||
      this.hitLine(x1, y1, x2, y2, rect.left, rect.bottom, rect.left, rect.top)
    );
  }

  private hitLine(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
    const a = this.turn(x1, y1, x2, y2, x3, y3);
    const b = this.turn(x1, y1, x2, y2, x4, y4);
    const c = this.turn(x3, y3, x4, y4, x1, y1);
    const d = this.turn(x3, y3, x4, y4, x2, y2);
    return (
      (a === 0 && this.onEdge(x3, y3, x1, y1, x2, y2)) ||
      (b === 0 && this.onEdge(x4, y4, x1, y1, x2, y2)) ||
      (c === 0 && this.onEdge(x1, y1, x3, y3, x4, y4)) ||
      (d === 0 && this.onEdge(x2, y2, x3, y3, x4, y4)) ||
      ((a > 0) !== (b > 0) && (c > 0) !== (d > 0))
    );
  }

  private turn(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  }

  private hitPoly(polygon: number[], x: number, y: number) {
    let inside = false;
    for (let index = 0, last = polygon.length - 2; index < polygon.length; last = index, index += 2) {
      const x1 = polygon[index];
      const y1 = polygon[index + 1];
      const x2 = polygon[last];
      const y2 = polygon[last + 1];
      if (this.onEdge(x, y, x1, y1, x2, y2)) {
        return true;
      }
      if ((y1 > y) !== (y2 > y) && x <= ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
        inside = !inside;
      }
    }
    return inside;
  }

  private onEdge(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
    return (
      (x - x1) * (y2 - y1) === (y - y1) * (x2 - x1) &&
      x >= Math.min(x1, x2) &&
      x <= Math.max(x1, x2) &&
      y >= Math.min(y1, y2) &&
      y <= Math.max(y1, y2)
    );
  }

  private page(pageIndex: number) {
    return this.result().pages[pageIndex];
  }

  private result() {
    if (!this.metadata) {
      throw new Error("AuroraLens: metadata is not loaded.");
    }
    return this.metadata;
  }
}
