import Fuse from "fuse.js";
import { MetadataRepository } from "./MetadataRepository";
import type { MetadataIndex, PageContext, PageFigure, PageInfo, PageMetadataHits, PageToken, SelectedGroup } from "./types";

const rectTolerance = 5;
const indexContextLimit = 1;

interface MetadataRoot {
  pages: PageData[];
}

interface PageData {
  pageNumber: number;
  width: number;
  height: number;
  class?: string;
  segments?: string[];
  indexes?: MetadataIndex[];
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

interface ContextItem {
  token: string | null;
  key: string;
  value: PageData["contexts"][number];
}

interface SearchQuery {
  mode: "and" | "or";
  terms: string[];
}

interface SearchToken extends TokenItem {
  score: number;
}

interface SearchContext extends ContextItem {
  score: number;
}

interface IndexContextScore {
  context: PageData["contexts"][number];
  contextCoverage: number;
  sourceCoverage: number;
  score: number;
  order: number;
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

  pageInfo(pageIndex: number): PageInfo {
    const page = this.page(pageIndex);
    return {
      pageNumber: page.pageNumber,
      class: page.class ?? null,
      segments: page.segments ?? [],
      indexes: page.indexes ?? [],
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

  search(pageIndex: number, text: string, context?: string | null): PageMetadataHits {
    const value = text.trim();
    const contextValue = context?.trim();
    console.info("[PACK] metadata search", {
      pageIndex,
      text,
      value,
      context: context ?? null,
      contextValue: contextValue ?? null,
    });
    if (!value && !contextValue) {
      console.info("[PACK] metadata search empty query");
      return {
        tokens: [],
        contexts: [],
        figures: [],
      };
    }
    const page = this.page(pageIndex);
    console.info("[PACK] metadata search page", {
      pageNumber: page.pageNumber,
      tokenCount: page.tokens.length,
      contextCount: page.contexts.length,
      figureCount: page.figures.length,
    });
    if (contextValue) {
      const contexts = this.searchContexts(page, contextValue);
      const foundTokens = value ? this.searchTokens(pageIndex, value) : [];
      console.info("[PACK] metadata search context branch", {
        contextMatches: contexts.length,
        tokenMatches: foundTokens.length,
      });
      if (value && !contexts.length) {
        const fallbackContexts = this.contexts(page, foundTokens);
        console.info("[PACK] metadata search context fallback", {
          tokenMatches: foundTokens.length,
          contextMatches: fallbackContexts.length,
        });
        return {
          tokens: foundTokens.map((token) => token.value),
          contexts: fallbackContexts,
          figures: [],
        };
      }
      const tokens = foundTokens.filter((token) => contexts.some((match) => this.hitPoly(match.polygon, ...this.center(token.polygon))));
      console.info("[PACK] metadata search restricted hits", {
        tokens: tokens.length,
        contexts: contexts.length,
      });
      return {
        tokens: tokens.map((token) => token.value),
        contexts: contexts.map((match) => this.context(match)),
        figures: [],
      };
    }
    const tokens = this.searchTokens(pageIndex, value);
    const contexts = this.contexts(page, tokens);
    console.info("[PACK] metadata search token branch", {
      tokens: tokens.length,
      contexts: contexts.length,
    });
    return {
      tokens: tokens.map((token) => token.value),
      contexts,
      figures: [],
    };
  }

  searchIndex(pageIndex: number, index: MetadataIndex): PageMetadataHits {
    const page = this.page(pageIndex);
    console.info("[PACK] metadata searchIndex", {
      pageIndex,
      pageNumber: page.pageNumber,
      value: index.value,
      source: index.source,
    });
    const tokens = this.searchTokens(pageIndex, index.value, "and");
    console.info("[PACK] index value token hits", {
      value: index.value,
      count: tokens.length,
      hits: tokens.map((token) => ({
        token: token.value.token,
        score: token.score,
        polygon: token.value.polygon,
      })),
    });
    const tokenContexts = this.contexts(page, tokens);
    const sourceContexts = this.searchIndexContexts(page, index.source).map((context) => this.context(context));
    console.info("[PACK] index source context hits", {
      source: index.source,
      count: sourceContexts.length,
      hits: sourceContexts.map((context) => ({
        content: context.content ?? null,
        polygon: context.polygon,
      })),
    });
    const contexts = this.mergeContexts([...tokenContexts, ...sourceContexts]);
    console.info("[PACK] index combined hits", {
      tokens: tokens.length,
      tokenContexts: tokenContexts.length,
      sourceContexts: sourceContexts.length,
      contexts: contexts.length,
    });
    return {
      tokens: tokens.map((token) => token.value),
      contexts,
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

  private searchTokens(pageIndex: number, text: string, mode?: SearchQuery["mode"]) {
    const items = this.tokenItems(pageIndex);
    const query = this.searchQuery(text, mode);
    console.info("[PACK] search tokens query", {
      pageIndex,
      text,
      mode: query.mode,
      terms: query.terms,
      itemCount: items.length,
    });
    if (!query.terms.length) {
      console.info("[PACK] search tokens empty terms");
      return [];
    }
    const matches = query.terms.map((term) => this.searchItems(items, term));
    console.info("[PACK] search tokens term matches", matches.map((match, index) => ({
      term: query.terms[index],
      count: match.length,
      hits: match.map((token) => ({
        token: token.value.token,
        score: token.score,
        polygon: token.value.polygon,
      })),
    })));
    if (query.mode === "or") {
      const tokens = this.uniqueTokens(matches.flat());
      console.info("[PACK] search tokens OR result", { count: tokens.length });
      return tokens;
    }
    if (matches.some((match) => !match.length)) {
      console.info("[PACK] search tokens AND missing term");
      return [];
    }
    if (matches.length === 1) {
      console.info("[PACK] search tokens single term result", { count: matches[0].length });
      return matches[0];
    }
    const tokens = this.contextTokens(pageIndex, matches);
    console.info("[PACK] search tokens AND context result", { count: tokens.length });
    return tokens;
  }

  private searchQuery(text: string, mode?: SearchQuery["mode"]): SearchQuery {
    const rawTerms = this.searchTerms(text);
    const hasOr = rawTerms.some((term) => /^or$/i.test(term));
    return {
      mode: mode ?? (hasOr ? "or" : "and"),
      terms: rawTerms.filter((term) => !/^(and|or)$/i.test(term)),
    };
  }

  private searchTerms(text: string) {
    return text.match(/[A-Za-z0-9#]+/g) ?? [];
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

  private searchItems<T extends { token: string | null }>(items: T[], text: string): Array<T & { score: number }> {
    return new Fuse(
      items.filter((item) => item.token),
      {
        keys: ["token"],
        threshold: 0.3,
        isCaseSensitive: false,
        includeScore: true,
      }
    ).search(text).map((match) => ({
      ...match.item,
      score: match.score!,
    }));
  }

  private searchContexts(page: PageData, text: string) {
    const items = this.contextItems(page);
    const query = this.searchQuery(text);
    console.info("[PACK] search contexts query", {
      pageNumber: page.pageNumber,
      text,
      mode: query.mode,
      terms: query.terms,
      itemCount: items.length,
    });
    if (!query.terms.length) {
      console.info("[PACK] search contexts empty terms");
      return [];
    }
    const matches = query.terms.map((term) => this.searchItems(items, term));
    console.info("[PACK] search contexts term matches", matches.map((match, index) => ({
      term: query.terms[index],
      count: match.length,
      hits: match.map((context) => ({
        token: context.token,
        score: context.score,
        polygon: context.value.polygon,
        content: context.value.content ?? null,
      })),
    })));
    if (query.mode === "or") {
      const contexts = this.uniqueContexts(matches.flat());
      console.info("[PACK] search contexts OR result", { count: contexts.length });
      return contexts;
    }
    if (matches.some((match) => !match.length)) {
      console.info("[PACK] search contexts AND missing term");
      return [];
    }
    const contexts = this.intersectContexts(matches);
    console.info("[PACK] search contexts AND result", { count: contexts.length });
    return contexts;
  }

  private searchIndexContexts(page: PageData, text: string) {
    const query = this.searchQuery(text, "or");
    console.info("[PACK] index source query", {
      source: text,
      terms: query.terms,
    });
    const ranked = page.contexts
      .map((context, order) => this.scoreIndexContext(context, order, query.terms))
      .filter((match): match is IndexContextScore => Boolean(match))
      .sort((left, right) =>
        right.contextCoverage - left.contextCoverage ||
        right.sourceCoverage - left.sourceCoverage ||
        left.score - right.score ||
        left.order - right.order
      );
    console.info("[PACK] index source ranked contexts", ranked.map((match) => ({
      content: match.context.content ?? null,
      polygon: match.context.polygon,
      contextCoverage: match.contextCoverage,
      sourceCoverage: match.sourceCoverage,
      score: match.score,
      order: match.order,
    })));
    return ranked.slice(0, indexContextLimit).map((match) => match.context);
  }

  private scoreIndexContext(context: PageData["contexts"][number], order: number, sourceTerms: string[]): IndexContextScore | null {
    const contextTerms = this.searchTerms(context.content ?? "");
    if (!sourceTerms.length || !contextTerms.length) {
      return null;
    }
    const contextItems = contextTerms.map((term, index) => ({
      token: term,
      index,
    }));
    const matchedContextTerms = new Set<number>();
    const matchedSourceTerms = new Set<number>();
    let score = 1;
    sourceTerms.forEach((term, sourceIndex) => {
      const matches = this.searchItems(contextItems, term);
      if (!matches.length) {
        return;
      }
      matchedSourceTerms.add(sourceIndex);
      matches.forEach((match) => matchedContextTerms.add(match.index));
      score = Math.min(score, ...matches.map((match) => match.score));
    });
    if (!matchedContextTerms.size) {
      return null;
    }
    return {
      context,
      contextCoverage: matchedContextTerms.size / contextTerms.length,
      sourceCoverage: matchedSourceTerms.size / sourceTerms.length,
      score,
      order,
    };
  }

  private contextItems(page: PageData) {
    return page.contexts.flatMap((context) => this.searchTerms(context.content ?? "").map((term) => ({
      token: term,
      key: this.contextKey(context),
      value: context,
    })));
  }

  private uniqueContexts(contexts: SearchContext[]) {
    const found = new Map<string, SearchContext>();
    contexts.forEach((context) => {
      found.set(context.key, context);
    });
    return Array.from(found.values()).map((context) => context.value);
  }

  private mergeContexts(contexts: PageContext[]) {
    const found = new Map<string, PageContext>();
    contexts.forEach((context) => {
      found.set(this.contextKey(context), context);
    });
    return Array.from(found.values());
  }

  private contextKey(context: { polygon: number[] }) {
    return context.polygon.join(",");
  }

  private intersectContexts(matches: SearchContext[][]) {
    const groups = matches.map((match) => {
      const found = new Map<string, SearchContext>();
      match.forEach((context) => {
        const current = found.get(context.key);
        if (!current || context.score < current.score) {
          found.set(context.key, context);
        }
      });
      return found;
    });
    return Array.from(groups[0].keys())
      .filter((key) => groups.every((group) => group.has(key)))
      .map((key) => groups.map((group) => group.get(key)!).reduce((best, context) => context.score < best.score ? context : best))
      .map((context) => context.value);
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
