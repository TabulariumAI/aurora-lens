import { describe, expect, it } from "vitest";
import Fuse from "fuse.js";
import { MetadataHelper } from "./MetadataHelper";
import { textMetadata } from "../../../tests/fixtures/textMetadata";

const index = (value: string, source = "") => ({ value, source, label: "Name", ambiguous: "NO" });

describe("ranked index highlighting", () => {
  it("highlights one occurrence in the first region when source and value are identical", () => {
    const data = textMetadata("seller recorder alpha bravo alpha bravo", "seller recorder alpha bravo");
    const original = structuredClone(data);
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index("bravo alpha", "seller recorder"));
    expect(hits.contexts.map(context => context.polygon)).toEqual([data.pages[0].contexts[0].polygon]);
    expect(hits.tokens.map(token => token.polygon)).toEqual([2, 3].map(position => data.pages[0].tokens[position].polygon));
    expect(hits.figures).toEqual([]);
    expect(data).toEqual(original);
    expect(helper.highlightIndex(0, index("bravo alpha", "seller recorder"))).toEqual(hits);
  });

  it.each([
    [["seller recorder alpha", "alpha bravo outsider"], "alpha bravo outsider", ["alpha", "bravo"], false],
    [["seller alpha bravo", "seller recorder alphx bravo"], "seller recorder alphx bravo", ["alphx", "bravo"], true],
    [["sellxr recorder alpha bravo", "seller recorder alpha bravo"], "seller recorder alpha bravo", ["alpha", "bravo"], true],
    [["seller recorder alphx bravo", "seller recorder alpha bravo"], "seller recorder alpha bravo", ["alpha", "bravo"], true],
    [["seller recorder alpha", "seller recorder Alphx bravo"], "seller recorder Alphx bravo", ["Alphx", "bravo"], true],
  ] as const)("ranks complete value, source coverage and Fuse score: %j", (paragraphs, winner, tokens, context) => {
    const data = textMetadata(...paragraphs);
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index("alpha AND bravo", "seller recorder"));
    expect(hits.tokens.map(token => token.token)).toEqual(tokens);
    expect(hits.tokens.every(token => token.polygon[1] >= 40)).toBe(true);
    expect(hits.contexts.map(context => context.content)).toEqual(context ? [winner] : []);
  });

  it("ranks occurrences inside a region by score before token position", () => {
    const data = textMetadata("seller recorder alphx bravo alpha bravo");
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.highlightIndex(0, index("alpha bravo", "seller recorder")).tokens.map(token => token.polygon))
      .toEqual([3, 4].map(position => data.pages[0].tokens[position].polygon));
  });

  it.each(["absent", "alpha missing", "", " ", "---"])("retains one best source region when value is unavailable: %s", value => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("sellxr recorder alpha", "seller recorder bravo", "seller recorder unrelated"));
    const hits = helper.highlightIndex(0, index(value, "seller recorder"));
    expect(hits.tokens).toEqual([]);
    expect(hits.contexts.map(context => context.content)).toEqual(["seller recorder bravo"]);
  });

  it("retains source ordering, gaps, fuzzy spelling and distinct repeated terms", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("PIANTIN0 F. GLADYS", "GLADYS unrelated F. PIANTIN0"));
    expect(helper.highlightIndex(0, index("absent", "GLADYS F PIANTINO")).contexts.map(context => context.content))
      .toEqual(["GLADYS unrelated F. PIANTIN0"]);
    helper.load(textMetadata("seller alpha", "seller seller bravo"));
    expect(helper.highlightIndex(0, index("absent", "seller seller")).contexts.map(context => context.content))
      .toEqual(["seller seller bravo"]);
  });

  it("counts distinct source positions when ranking complete values", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("seller alpha", "seller seller alphx"));
    const hits = helper.highlightIndex(0, index("alpha", "seller seller"));
    expect(hits.tokens.map(token => token.token)).toEqual(["alphx"]);
    expect(hits.contexts.map(context => context.content)).toEqual(["seller seller alphx"]);
  });

  it("uses the cheapest covered source terms when the full source is absent", () => {
    const data = textMetadata("alphx bravo", "alpha bravo");
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index("bravo", "alpha alphx"));
    expect(hits.tokens.map(token => token.polygon)).toEqual([data.pages[0].tokens[1].polygon]);
    expect(hits.contexts.map(context => context.polygon)).toEqual([data.pages[0].contexts[0].polygon]);
  });

  it.each(["absent", "alpha bravo"])("scores only valid ordered source occurrences for value %s", value => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("sellxr recorder seller alpha bravo", "seller recorder alpha bravo"));
    const hits = helper.highlightIndex(0, index(value, "seller recorder"));
    expect(hits.contexts.map(context => context.content)).toEqual(["seller recorder alpha bravo"]);
  });

  it("does not combine partial values from separate paragraphs", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("seller recorder alpha", "seller recorder bravo"));
    const hits = helper.highlightIndex(0, index("bravo alpha", "seller recorder"));
    expect(hits.tokens).toEqual([]);
    expect(hits.contexts.map(context => context.content)).toEqual(["seller recorder alpha"]);
  });

  it("returns one best OR alternative and ranks source OR coverage", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("seller alpha", "seller recorder bravo", "recorder alpha"));
    const hits = helper.highlightIndex(0, index("missing OR alpha OR bravo", "seller OR recorder"));
    expect(hits.tokens.map(token => token.token)).toEqual(["bravo"]);
    expect(hits.contexts.map(context => context.content)).toEqual(["seller recorder bravo"]);
  });

  it("returns one region for overlapping source paragraphs", () => {
    const data = textMetadata("seller recorder alpha bravo");
    data.pages[0].contexts.push({ ...data.pages[0].contexts[0], polygon: [0, 0, 10000, 0, 10000, 31, 0, 31] });
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index("bravo alpha", "seller recorder"));
    expect(hits.tokens.map(token => token.token)).toEqual(["alpha", "bravo"]);
    expect(hits.contexts.map(context => context.polygon)).toEqual([data.pages[0].contexts[0].polygon]);
  });

  it("does not highlight a context containing only part of the ordered source", () => {
    const data = textMetadata("seller recorder alpha bravo");
    data.pages[0].contexts.unshift({ content: "seller", role: "body", polygon: [0, 0, 20, 0, 20, 30, 0, 30] });
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.highlightIndex(0, index("bravo alpha", "seller recorder")).contexts.map(context => context.content))
      .toEqual(["seller recorder alpha bravo"]);
  });

  it.each(["", " ", "---", "unmatched source", "recorder seller"])("highlights the winning value paragraph for empty or unmatched source: %s", source => {
    const data = textMetadata("seller recorder alpha", "bravo alpha", "alpha bravo");
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index("bravo alpha", source));
    expect(hits.tokens.map(token => token.polygon)).toEqual([3, 4].map(position => data.pages[0].tokens[position].polygon));
    expect(hits.contexts.map(context => context.polygon)).toEqual([data.pages[0].contexts[1].polygon]);
  });

  it.each(["", "unmatched source"])("returns no hits when neither source nor value matches: %s", source => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("alpha bravo"));
    for (const value of ["absent", "", "alpha missing"]) {
      expect(helper.highlightIndex(0, index(value, source))).toEqual({ tokens: [], contexts: [], figures: [] });
    }
  });

  it.each([
    ["$50.00", ["Total Fees: $50.00", "Other Fees: $50.00"], 0, ["$50.00"]],
    ["alpha", ["alphx", "alpha"], 1, ["alpha"]],
    ["alpha alpha", ["alpha", "alpha alpha alpha"], 1, ["alpha", "alpha"]],
    ["missing OR bravo", ["alpha", "bravo"], 1, ["bravo"]],
  ] as const)("selects one value paragraph without a source match: %s", (value, paragraphs, winner, tokens) => {
    const data = textMetadata(...paragraphs);
    const original = structuredClone(data);
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index(value, "unmatched source"));
    expect(hits.tokens.map(token => token.token)).toEqual(tokens);
    expect(hits.contexts.map(context => context.polygon)).toEqual([data.pages[0].contexts[winner].polygon]);
    expect(helper.highlightIndex(0, index(value, "unmatched source"))).toEqual(hits);
    expect(data).toEqual(original);
  });

  it("retains page-wide value tokens without inventing a paragraph across separate regions", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("alpha", "bravo"));
    const hits = helper.highlightIndex(0, index("bravo alpha", "unmatched source"));
    expect(hits.tokens.map(token => token.token)).toEqual(["alpha", "bravo"]);
    expect(hits.contexts).toEqual([]);
  });

  it("returns one winning value paragraph when regions overlap and source is absent", () => {
    const data = textMetadata("alpha bravo");
    data.pages[0].contexts.push({ ...data.pages[0].contexts[0], polygon: [0, 0, 10000, 0, 10000, 31, 0, 31] });
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.highlightIndex(0, index("bravo alpha")).contexts.map(context => context.polygon))
      .toEqual([data.pages[0].contexts[0].polygon]);
  });

  it("highlights one value occurrence when contexts are absent", () => {
    const data = textMetadata("alpha bravo alpha bravo");
    data.pages[0].contexts = [];
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.highlightIndex(0, index("bravo alpha", "alpha bravo"));
    expect(hits.tokens.map(token => token.polygon)).toEqual(data.pages[0].tokens.slice(0, 2).map(token => token.polygon));
    expect(hits.contexts).toEqual([]);
    expect(helper.search(0, "alpha bravo").tokens).toEqual([]);
  });

  it("requires distinct normalized positions for repeated unordered value terms", () => {
    const data = textMetadata("alpha", "alpha alpha alpha");
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.highlightIndex(0, index("alpha alpha")).tokens.map(token => token.polygon))
      .toEqual(data.pages[0].tokens.slice(1, 3).map(token => token.polygon));
    helper.load(textMetadata("alpha"));
    expect(helper.highlightIndex(0, index("alpha alpha")).tokens).toEqual([]);
  });

  it("finds a complete assignment when a fuzzy term competes for another term's position", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("alpha alphx"));
    expect(helper.highlightIndex(0, index("alpha alphaa")).tokens.map(token => token.token)).toEqual(["alpha", "alphx"]);
  });

  it("handles repeated terms without enumerating token permutations", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata(`${"alpha ".repeat(18)}bravo bravo`));
    expect(helper.highlightIndex(0, index(`${"alpha ".repeat(19)}bravo`)).tokens).toEqual([]);
    expect(helper.highlightIndex(0, index(`${"alpha ".repeat(18)}bravo`)).tokens).toHaveLength(19);
  });

  it("preserves compound tokens and prefers exact initials over containing words", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Lucy Clerk Mail Jose L. Salinas Trustee's substitute/successor"));
    expect(helper.highlightIndex(0, index("SALINAS JOSE L")).tokens.map(token => token.token)).toEqual(["Jose", "L.", "Salinas"]);
    expect(helper.highlightIndex(0, index("successor substitute Trustee's")).tokens.map(token => token.token))
      .toEqual(["Trustee's", "substitute/successor"]);
  });

  it("counts normalized source positions before deduplicating original compound tokens", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Trustee's substitute/successor alpha", "Trustee s substitute successor alphx"));
    const hits = helper.highlightIndex(0, index("alpha", "Trustee's substitute/successor"));
    expect(hits.tokens.map(token => token.token)).toEqual(["alpha"]);
    expect(hits.contexts.map(context => context.content)).toEqual(["Trustee's substitute/successor alpha"]);
  });

  it("does not search other pages or mutate subsequent ordered Search", () => {
    const data = textMetadata("seller recorder bravo alpha");
    data.pages.push(textMetadata("seller recorder charlie delta").pages[0]);
    const helper = new MetadataHelper();
    helper.load(data);
    const before = helper.search(0, "alpha bravo");
    expect(helper.highlightIndex(0, index("delta charlie", "seller recorder")).tokens).toEqual([]);
    expect(helper.highlightIndex(1, index("delta charlie", "seller recorder")).tokens.map(token => token.token)).toEqual(["charlie", "delta"]);
    expect(helper.search(0, "alpha bravo")).toEqual(before);
    expect(helper.search(0, "bravo alpha").tokens.map(token => token.token)).toEqual(["bravo", "alpha"]);
  });

  it("highlights the minimum-score distinct assignment across deterministic duplicate and fuzzy sequences", () => {
    const words = ["alpha", "alphx", "bravo"];
    for (let sample = 0; sample < 81; sample += 1) {
      let number = sample;
      const paragraph = Array.from({ length: 4 }, () => { const word = words[number % 3]; number = Math.floor(number / 3); return word; });
      const data = textMetadata(paragraph.join(" "));
      const helper = new MetadataHelper();
      helper.load(data);
      for (const query of [["alpha", "bravo"], ["alpha", "alpha"], ["bravo", "alpha", "alpha"]]) {
        let best: number[] = [];
        let score = Infinity;
        const visit = (path: number[], cost: number) => {
          if (path.length === query.length) {
            if (cost < score) { best = path; score = cost; }
            return;
          }
          for (let position = 0; position < paragraph.length; position += 1) {
            if (path.includes(position) || paragraph[position].slice(0, 4) !== query[path.length].slice(0, 4)) continue;
            visit([...path, position], cost + Number(paragraph[position] !== query[path.length]));
          }
        };
        visit([], 0);
        expect(helper.highlightIndex(0, index(query.join(" "))).tokens.map(token => token.polygon), `${paragraph}; ${query}`)
          .toEqual([...best].sort((left, right) => left - right).map(position => data.pages[0].tokens[position].polygon));
      }
    }
  });

  it("agrees with exhaustive minimum costs when fuzzy terms share candidate positions", () => {
    const words = ["alpha", "alphx", "alphaa", "bravo"];
    for (let sample = 0; sample < 64; sample += 1) {
      let number = sample;
      const paragraph = Array.from({ length: 3 }, () => { const word = words[number % 4]; number = Math.floor(number / 4); return word; });
      const data = textMetadata(paragraph.join(" "));
      const helper = new MetadataHelper();
      helper.load(data);
      for (const query of [["alpha", "alphaa"], ["alphaa", "alphx", "alpha"]]) {
        const values = paragraph.map(token => ({ token }));
        const options = { keys: ["token"], threshold: 0.3, includeScore: true };
        const fuzzy = new Fuse(values, { ...options, useTokenSearch: true });
        const exact = new Fuse(values, { ...options, useExtendedSearch: true });
        const scores = query.map(term => {
          const hits = new Map(fuzzy.search(term).map(hit => [hit.refIndex, hit.score!]));
          exact.search(`=${term}`).forEach(hit => hits.set(hit.refIndex, hit.score!));
          return hits;
        });
        const paths: { positions: number[]; cost: number }[] = [];
        const visit = (positions: number[], cost: number) => {
          if (positions.length === query.length) { paths.push({ positions, cost }); return; }
          for (const [position, score] of scores[positions.length]) {
            if (!positions.includes(position)) visit([...positions, position], cost + score);
          }
        };
        visit([], 0);
        const actual = helper.highlightIndex(0, index(query.join(" "))).tokens.map(token => data.pages[0].tokens.findIndex(item => item.polygon === token.polygon));
        if (!paths.length) {
          expect(actual).toEqual([]);
        } else {
          expect(actual).toHaveLength(query.length);
          const selected = paths.filter(path => path.positions.every(position => actual.includes(position)));
          expect(Math.min(...selected.map(path => path.cost)), `${paragraph}; ${query}`).toBeCloseTo(Math.min(...paths.map(path => path.cost)), 12);
        }
      }
    }
  });

  it("ranks partial source coverage and costs against exhaustive assignments", () => {
    const words = ["alpha", "alphx", "alphaa", "outsider"];
    const source = ["alpha", "alphx", "alphaa"];
    const values = words.map(token => ({ token }));
    const options = { keys: ["token"], threshold: 0.3, includeScore: true };
    const fuzzy = new Fuse(values, { ...options, useTokenSearch: true });
    const exact = new Fuse(values, { ...options, useExtendedSearch: true });
    const scores = source.map(term => {
      const hits = new Map(fuzzy.search(term).map(hit => [hit.item.token, hit.score!]));
      exact.search(`=${term}`).forEach(hit => hits.set(hit.item.token, hit.score!));
      return hits;
    });
    for (let sample = 0; sample < 256; sample += 1) {
      let number = sample;
      const tokens = Array.from({ length: 4 }, () => { const word = words[number % 4]; number = Math.floor(number / 4); return word; });
      const regions = [tokens.slice(0, 2), tokens.slice(2)];
      const ranks = regions.map(region => {
        let count = -1;
        let score = Infinity;
        const visit = (term: number, positions: number[], cost: number) => {
          if (term === source.length) {
            if (positions.length > count || (positions.length === count && cost < score)) { count = positions.length; score = cost; }
            return;
          }
          visit(term + 1, positions, cost);
          region.forEach((word, position) => {
            const match = scores[term].get(word);
            if (match !== undefined && !positions.includes(position)) visit(term + 1, [...positions, position], cost + match);
          });
        };
        visit(0, [], 0);
        return { count, score };
      });
      const winner = ranks[1].count > ranks[0].count || (ranks[1].count === ranks[0].count && ranks[1].score < ranks[0].score) ? 1 : 0;
      const data = textMetadata(...regions.map(region => [...region, "bravo"].join(" ")));
      const helper = new MetadataHelper();
      helper.load(data);
      expect(helper.highlightIndex(0, index("bravo", source.join(" "))).tokens.map(token => token.polygon), tokens.join(" "))
        .toEqual([data.pages[0].tokens[winner * 3 + 2].polygon]);
    }
  });
});
