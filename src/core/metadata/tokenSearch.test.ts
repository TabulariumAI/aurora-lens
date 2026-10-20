import { describe, expect, it } from "vitest";
import { MetadataHelper } from "./MetadataHelper";
import { textMetadata } from "../../../tests/fixtures/textMetadata";

describe("ordered fuzzy token search", () => {
  it.each([
    ["GLADYS F PIANTINO", true],
    ["PIANTINO GLADYS F", false],
    ["F GLADYS PIANTINO", false],
    ["GLADYS AND F AND PIANTINO", true],
    ["PIANTINO AND GLADYS AND F", false],
  ] as const)("requires token order with existing fuzzy spelling: %s", (query, found) => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("GLADYS F. PIANTIN0"));
    const hits = helper.search(0, query);
    expect(hits.tokens.map(token => token.token)).toEqual(found ? ["GLADYS", "F.", "PIANTIN0"] : []);
    expect(hits.contexts).toHaveLength(found ? 1 : 0);
  });

  it("keeps multiple ordered paragraphs and rejects reversed paragraphs", () => {
    const data = textMetadata("alpha bravo", "bravo alpha", "alpha unrelated bravo");
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.search(0, "alpha bravo");
    expect(hits.contexts.map(context => context.content)).toEqual(["alpha bravo", "alpha unrelated bravo"]);
    expect(hits.tokens.map(token => token.polygon)).toEqual([0, 1, 4, 6].map(index => data.pages[0].tokens[index].polygon));
  });

  it("returns only tokens participating in an ordered match", () => {
    const data = textMetadata("bravo alpha bravo alpha");
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.search(0, "alpha bravo").tokens.map(token => token.polygon)).toEqual([data.pages[0].tokens[1].polygon, data.pages[0].tokens[2].polygon]);
  });

  it.each([["alpha", 0], ["alpha alpha", 2], ["alpha alpha alpha", 3]] as const)("does not reuse a token position for ordered terms: %s", (paragraph, count) => {
    const helper = new MetadataHelper();
    helper.load(textMetadata(paragraph));
    expect(helper.search(0, "alpha alpha").tokens).toHaveLength(count);
  });

  it("preserves single-token search without paragraphs and OR alternatives", () => {
    const data = textMetadata("alpha bravo");
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.search(0, "missing OR alpha").tokens.map(token => token.token)).toEqual(["alpha"]);
    expect(helper.search(0, "bravo OR alpha").tokens.map(token => token.token)).toEqual(["bravo", "alpha"]);
    data.pages[0].contexts = [];
    expect(helper.search(0, "alpha").tokens.map(token => token.token)).toEqual(["alpha"]);
    expect(helper.search(0, "alpha bravo").tokens).toEqual([]);
  });

  it("keeps fuzzy occurrences, missing terms, empty queries and page boundaries", () => {
    const data = textMetadata("alpha", "alphx bravo");
    data.pages.push(textMetadata("charlie delta").pages[0]);
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.search(0, "alpha bravo").tokens.map(token => token.token)).toEqual(["alphx", "bravo"]);
    for (const query of ["charlie delta", "alpha missing", "", "---"]) expect(helper.search(0, query)).toEqual({ tokens: [], contexts: [], figures: [] });
    expect(helper.search(1, "charlie delta").tokens.map(token => token.token)).toEqual(["charlie", "delta"]);
  });

  it("rejects reversed value order even when a context quote matches", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("alpha bravo"));
    expect(helper.search(0, "bravo alpha", "alpha bravo")).toEqual({ tokens: [], contexts: [], figures: [] });
  });

  it("keeps explicit context scoping and unmatched-context behavior", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("alpha bravo seller", "alpha bravo beneficiary"));
    expect(helper.search(0, "alpha bravo", "beneficiary").contexts.map(context => context.content)).toEqual(["alpha bravo beneficiary"]);
    expect(helper.search(0, "alpha bravo", "unmatched").contexts).toHaveLength(2);
    expect(helper.search(0, "", "beneficiary").tokens).toEqual([]);
    expect(helper.search(0, "", "beneficiary").contexts).toHaveLength(1);
  });

  it("keeps a fuzzy sequence when an exact spelling occurs after the next term", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Alphx bravo alpha"));
    expect(helper.search(0, "alpha bravo").tokens.map(token => token.token)).toEqual(["Alphx", "bravo"]);
  });

  it.each(["alpha bravo", "alpha AND bravo"])("returns all exact and fuzzy occurrences for %s", query => {
    const data = textMetadata("alpha bravo", "alphx bravo", "alpha bravx", "alphx bravx", "bravo alphx");
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.search(0, query);
    expect(hits.tokens.map(token => token.polygon)).toEqual(data.pages[0].tokens.slice(0, 8).map(token => token.polygon));
    expect(hits.contexts.map(context => context.content)).toEqual(data.pages[0].contexts.slice(0, 4).map(context => context.content));
  });

  it("keeps unequal fuzzy scores inside the same ordered region", () => {
    const data = textMetadata("alpha alphx bravo bravx");
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.search(0, "alpha bravo").tokens.map(token => token.polygon)).toEqual(data.pages[0].tokens.map(token => token.polygon));
  });

  it("returns exact and fuzzy single terms and OR alternatives once per original token", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("alpha alphx bravo bravx"));
    expect(helper.search(0, "alpha").tokens.map(token => token.token)).toEqual(["alpha", "alphx"]);
    expect(helper.search(0, "alpha OR bravo").tokens.map(token => token.token)).toEqual(["alpha", "alphx", "bravo", "bravx"]);
    helper.load(textMetadata("substitute/successor"));
    expect(helper.search(0, "substitute OR successor").tokens.map(token => token.token)).toEqual(["substitute/successor"]);
  });

  it("includes fuzzy context regions alongside exact regions and still scopes value tokens", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("seller alpha bravo", "sellxr alphx bravx", "outsider alpha bravo"));
    const hits = helper.search(0, "alpha bravo", "seller");
    expect(hits.tokens.map(token => token.token)).toEqual(["alpha", "bravo", "alphx", "bravx"]);
    expect(hits.contexts.map(context => context.content)).toEqual(["seller alpha bravo", "sellxr alphx bravx"]);
    expect(helper.search(0, "", "seller")).toEqual({ ...hits, tokens: [] });
  });

  it("agrees with complete ordered occurrences for deterministic sequences", () => {
    const words = ["alpha", "bravo", "charlie"];
    for (let sample = 0; sample < 81; sample += 1) {
      let value = sample;
      const paragraph = Array.from({ length: 4 }, () => { const word = words[value % 3]; value = Math.floor(value / 3); return word; });
      const data = textMetadata(paragraph.join(" "));
      const helper = new MetadataHelper();
      helper.load(data);
      for (const query of [["alpha", "bravo"], ["bravo", "alpha"], ["alpha", "alpha"], ["alpha", "bravo", "charlie"]]) {
        const paths: number[][] = [];
        const visit = (positions: number[]) => {
          if (positions.length === query.length) { paths.push(positions); return; }
          for (let position = positions.length ? positions[positions.length - 1] + 1 : 0; position < paragraph.length; position += 1) {
            if (paragraph[position] === query[positions.length]) visit([...positions, position]);
          }
        };
        visit([]);
        const expected = [...new Set(paths.flat())].sort((a, b) => a - b).map(position => data.pages[0].tokens[position].polygon);
        const hits = helper.search(0, query.join(" "));
        if (hits.tokens.length) expect(helper.highlightIndex(0, { value: query.join(" "), source: paragraph.join(" "), label: "Value", ambiguous: "NO" }).tokens.length).toBeGreaterThan(0);
        expect(hits.tokens.map(token => token.polygon).sort((a, b) => a[0] - b[0]), `${paragraph}; ${query}`).toEqual(expected);
      }
    }
  });

  it("returns every complete exact or fuzzy ordered occurrence across deterministic sequences", () => {
    const words = ["alpha", "alphx", "bravo", "bravx"];
    for (let sample = 0; sample < 256; sample += 1) {
      let number = sample;
      const paragraph = Array.from({ length: 4 }, () => { const word = words[number % 4]; number = Math.floor(number / 4); return word; });
      const data = textMetadata(paragraph.join(" "));
      const helper = new MetadataHelper();
      helper.load(data);
      for (const query of [["alpha", "bravo"], ["alpha", "alpha"], ["bravo", "alpha", "bravo"]]) {
        const positions = new Set<number>();
        const visit = (path: number[]) => {
          if (path.length === query.length) { path.forEach(position => positions.add(position)); return; }
          for (let position = path.length ? path[path.length - 1] + 1 : 0; position < paragraph.length; position += 1) {
            if (paragraph[position].slice(0, 4) === query[path.length].slice(0, 4)) visit([...path, position]);
          }
        };
        visit([]);
        expect(helper.search(0, query.join(" ")).tokens.map(token => token.polygon), `${paragraph}; ${query}`)
          .toEqual([...positions].sort((left, right) => left - right).map(position => data.pages[0].tokens[position].polygon));
      }
    }
  });
});
