import { hitPoly, onEdge } from "../geometry";
import Fuse from "fuse.js";
import type { MetadataIndex, PageContext, PageFigure, PageInfo, PageMetadataHits, PageToken, SelectedGroup } from "../types";

const rectTolerance = 5;

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

interface SearchToken extends TokenItem {
  score: number;
  position: number;
}

interface TokenMatch {
  tokens: SearchToken[];
  context: PageData["contexts"][number] | null;
  score: number;
}

interface TokenQuery {
  mode: "and" | "or";
  matches: SearchToken[][];
}

export class MetadataHelper {
  private metadata: MetadataRoot | null = null;

  load(pageMetadata: unknown) {
    const metadata = pageMetadata as MetadataRoot;
    if (!Array.isArray(metadata.pages)) {
      throw new Error("AuroraLens.loadMetadata: metadata must include pages.");
    }
    this.metadata = metadata;
  }

  loadPage(pageIndex: number, pageMetadata: unknown) {
    const pages: PageData[] = [];
    pages[pageIndex] = pageMetadata as PageData;
    this.load({ pages });
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
      .filter((token) => hitPoly(token.polygon, x, y))
      .map((token) => this.token(token));
    return {
      tokens,
      contexts: page.contexts
        .filter((context) => hitPoly(context.polygon, x, y))
        .filter((context) => !tokens.some((token) => this.containsPoly(token.polygon, context.polygon)))
        .map((context) => this.context(context)),
      figures: page.figures
        .filter((figure) => hitPoly(figure.polygon, x, y))
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

  selectionItems(pageIndex: number): PageMetadataHits[] {
    const page = this.page(pageIndex);
    return [
      ...this.tokenItems(pageIndex).map(token => ({
        tokens: [token.value], contexts: this.contexts(page, [token]), figures: [],
      })),
      ...page.figures.map(figure => ({ tokens: [], contexts: [], figures: [this.figure(figure)] })),
    ];
  }

  search(pageIndex: number, text: string, context?: string | null): PageMetadataHits {
    const value = text.trim();
    const contextValue = context?.trim();
    if (!value && !contextValue) {
      return {
        tokens: [],
        contexts: [],
        figures: [],
      };
    }
    const page = this.page(pageIndex);
    const items = this.tokenTerms(this.tokenItems(pageIndex));
    const query = this.searchItems(items, value);
    const hits = this.uniqueTokens(this.searchTokens(items, page.contexts, query, true, false).flatMap(match => match.tokens));
    if (contextValue) {
      const contexts = this.searchContexts(page, contextValue);
      if (value && !hits.length && this.searchTokens(items, page.contexts, query, false, false).length) {
        return { tokens: [], contexts: [], figures: [] };
      }
      if (value && !contexts.length) {
        const tokenContexts = this.contexts(page, hits);
        return {
          tokens: hits.map((token) => token.value),
          contexts: tokenContexts,
          figures: [],
        };
      }
      const tokens = hits.filter((token) => contexts.some((match) => hitPoly(match.polygon, ...this.center(token.polygon))));
      return {
        tokens: tokens.map((token) => token.value),
        contexts: contexts.map((match) => this.context(match)),
        figures: [],
      };
    }
    return {
      tokens: hits.map((token) => token.value),
      contexts: this.contexts(page, hits),
      figures: [],
    };
  }

  highlightIndex(pageIndex: number, index: MetadataIndex): PageMetadataHits {
    const page = this.page(pageIndex);
    const items = this.tokenTerms(this.tokenItems(pageIndex));
    const sourceQuery = this.searchItems(items, index.source);
    const valueQuery = this.searchItems(items, index.value);
    const sources = this.searchTokens(items, page.contexts, sourceQuery, true, false);
    const contexts = page.contexts.filter(context => sources.some(match => match.context
      ? match.context === context
      : match.tokens.some(token => hitPoly(context.polygon, ...this.center(token.polygon)))));
    let matches = this.searchTokens(items, page.contexts.length ? page.contexts : null, valueQuery, false, true);
    if (!matches.length && !contexts.length && page.contexts.length) {
      matches = this.searchTokens(items, null, valueQuery, false, true);
    }
    const candidates = matches.length ? matches : contexts.map(context => ({ context, tokens: [], score: 0 }));
    let winner: TokenMatch | null = null;
    let coverage = -1;
    let score = Infinity;
    for (const candidate of candidates) {
      const sourceMatch = candidate.context ? sources.find(match => match.context === candidate.context) : undefined;
      let count: number;
      let cost = candidate.score;
      if (sourceMatch) {
        count = sourceQuery.matches.length;
        cost += sourceMatch.score;
      } else {
        const hits = this.selectTokens(sourceQuery.matches.map(group => group
          .filter(token => !candidate.context || hitPoly(candidate.context.polygon, ...this.center(token.polygon)))
          .sort((left, right) => left.position - right.position)), true);
        count = hits.length;
        cost += hits.reduce((total, token) => total + token.score, 0);
      }
      if (count > coverage || (count === coverage && cost < score)) {
        winner = candidate;
        coverage = count;
        score = cost;
      }
    }
    return {
      tokens: winner ? winner.tokens.map(token => token.value) : [],
      contexts: winner?.context && (!contexts.length || contexts.includes(winner.context)) ? [this.context(winner.context)] : [],
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

  private searchTokens(items: TokenItem[], contexts: PageData["contexts"] | null, { mode, matches }: TokenQuery, ordered: boolean, select: boolean): TokenMatch[] {
    if (!matches.length) return [];
    if (mode === "or") {
      if (select) return this.contextTokens(items, contexts, [matches.flat()], false, true);
      const tokens = this.uniqueTokens(matches.flat());
      return [{ tokens, context: null, score: Math.min(...tokens.map(token => token.score)) }];
    }
    if (matches.some((match) => !match.length)) {
      return [];
    }
    if (matches.length === 1 && !select) {
      return [{ tokens: matches[0], context: null, score: Math.min(...matches[0].map(token => token.score)) }];
    }
    return this.contextTokens(items, contexts, matches, ordered, select);
  }

  private tokenTerms(items: TokenItem[]) {
    return items.flatMap(item => this.searchTerms(item.token ?? "").map(token => ({ ...item, token })))
      .map((item, position) => ({ ...item, position }));
  }

  private searchTerms(text: string) {
    return text.replace(/[.,]/g, "").match(/[A-Za-z0-9#]+/g) ?? [];
  }

  private uniqueTokens<T extends TokenItem>(tokens: T[]) {
    const found = new Map<string, T>();
    tokens.forEach((token) => {
      found.set(this.selectKey(token.value), token);
    });
    return Array.from(found.values());
  }

  private contextTokens(items: TokenItem[], contexts: PageData["contexts"] | null, matches: SearchToken[][], ordered: boolean, select: boolean): TokenMatch[] {
    const tokens: TokenMatch[] = [];
    (contexts ?? [null]).forEach((context) => {
      const contextMatches = matches.map(match => match
        .filter(token => !context || hitPoly(context.polygon, ...this.center(token.polygon)))
        .sort((left, right) => left.position - right.position));
      if (contextMatches.some(match => !match.length)) {
        return;
      }
      if (ordered) {
        let first = -1;
        for (let term = 0; term < contextMatches.length; term += 1) {
          contextMatches[term] = contextMatches[term].filter(token => token.position > first);
          if (!contextMatches[term].length) return;
          first = contextMatches[term][0].position;
        }
        let last = items.length;
        for (let term = contextMatches.length - 1; term >= 0; term -= 1) {
          contextMatches[term] = contextMatches[term].filter(token => token.position < last);
          last = contextMatches[term][contextMatches[term].length - 1].position;
        }
      }
      let costs = contextMatches[0].map(token => token.score);
      if (ordered) {
        for (let term = 1; term < contextMatches.length; term += 1) {
          let position = 0;
          let best = Infinity;
          costs = contextMatches[term].map(token => {
            while (position < contextMatches[term - 1].length && contextMatches[term - 1][position].position < token.position) {
              best = Math.min(best, costs[position]);
              position += 1;
            }
            return best + token.score;
          });
        }
      }
      const hits = select ? this.selectTokens(contextMatches, false) : contextMatches.flat();
      if (hits.length) tokens.push({
        context,
        tokens: this.uniqueTokens(hits).sort((left, right) => left.position - right.position),
        score: select ? hits.reduce((total, token) => total + token.score, 0)
          : ordered ? Math.min(...costs)
            : contextMatches.reduce((total, group) => total + Math.min(...group.map(token => token.score)), 0),
      });
    });
    return tokens;
  }

  private selectTokens(matches: SearchToken[][], partial: boolean): SearchToken[] {
    const selected: SearchToken[] = [];
    const owners = new Map<number, number>();
    for (let count = 0; count < matches.length; count += 1) {
      const costs = matches.map((_, term) => selected[term] ? Infinity : 0);
      const paths = new Map<number, { term: number; token: SearchToken; cost: number }>();
      for (let pass = 0; pass < matches.length; pass += 1) {
        let changed = false;
        for (let query = 0; query < matches.length; query += 1) {
          if (costs[query] === Infinity) continue;
          for (const token of matches[query]) {
            if (selected[query]?.position === token.position) continue;
            const cost = costs[query] + token.score;
            const previous = paths.get(token.position);
            if (previous && cost >= previous.cost) continue;
            paths.set(token.position, { term: query, token, cost });
            const owner = owners.get(token.position);
            if (owner !== undefined && cost - selected[owner].score < costs[owner]) {
              costs[owner] = cost - selected[owner].score;
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      let next = Array.from(paths.values())
        .filter(path => !owners.has(path.token.position))
        .sort((left, right) => left.cost - right.cost || left.token.position - right.token.position)[0];
      if (!next) {
        if (!partial) return [];
        break;
      }
      // Reassign occupied positions along the cheapest augmenting path.
      while (next) {
        const previous = selected[next.term];
        selected[next.term] = next.token;
        owners.set(next.token.position, next.term);
        if (!previous) break;
        owners.delete(previous.position);
        next = paths.get(previous.position)!;
      }
    }
    return selected.filter(token => token);
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
      .filter((context) => tokens.some((token) => hitPoly(context.polygon, ...this.center(token.polygon))))
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

  private searchItems<T extends { token: string }>(items: T[], text: string) {
    const terms = this.searchTerms(text);
    const mode: "and" | "or" = terms.some(term => /^or$/i.test(term)) ? "or" : "and";
    const queries = terms.filter(term => !/^(and|or)$/i.test(term));
    const matches: Array<Array<T & { score: number }>> = [];
    if (!queries.length) return { mode, matches };
    const options = {
      keys: ["token"],
      threshold: 0.3,
      isCaseSensitive: false,
      includeScore: true,
    };
    const exact = new Fuse(items, {
      ...options,
      useExtendedSearch: true,
    });
    const fuzzy = new Fuse(items, { ...options, useTokenSearch: true });
    const cache = new Map<string, Array<T & { score: number }>>();
    for (const query of queries) {
      const key = query.toLowerCase();
      let hits = cache.get(key);
      if (!hits) {
        const results = new Map(fuzzy.search(query).map(result => [result.refIndex, result]));
        exact.search(`=${query}`).forEach(result => results.set(result.refIndex, result));
        hits = Array.from(results.values(), result => ({ ...result.item, score: result.score! }));
        cache.set(key, hits);
      }
      matches.push(hits);
    }
    return { mode, matches };
  }

  private searchContexts(page: PageData, text: string) {
    const items = this.contextItems(page);
    const { mode, matches } = this.searchItems(items, text);
    if (!matches.length) return [];
    const candidates = mode === "or" ? matches.flat() : matches[0];
    const contexts = new Map(candidates.map(context => [context.key, context.value]));
    if (mode === "or") return Array.from(contexts.values());
    const groups = matches.map(group => new Set(group.map(context => context.key)));
    return Array.from(contexts).filter(([key]) => groups.every(group => group.has(key))).map(([, context]) => context);
  }

  private contextItems(page: Pick<PageData, "contexts">) {
    return page.contexts.flatMap((context) => this.searchTerms(context.content ?? "").map((term) => ({
      token: term,
      key: context.polygon.join(","),
      value: context,
    })));
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
      if (!hitPoly(polygon, inner[index], inner[index + 1])) {
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
      hitPoly(polygon, rect.left, rect.top) ||
      hitPoly(polygon, rect.right, rect.top) ||
      hitPoly(polygon, rect.right, rect.bottom) ||
      hitPoly(polygon, rect.left, rect.bottom)
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
      (a === 0 && onEdge(x3, y3, x1, y1, x2, y2)) ||
      (b === 0 && onEdge(x4, y4, x1, y1, x2, y2)) ||
      (c === 0 && onEdge(x1, y1, x3, y3, x4, y4)) ||
      (d === 0 && onEdge(x2, y2, x3, y3, x4, y4)) ||
      ((a > 0) !== (b > 0) && (c > 0) !== (d > 0))
    );
  }

  private turn(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
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
