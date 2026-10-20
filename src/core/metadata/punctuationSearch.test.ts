import { describe, expect, it } from "vitest";
import { MetadataHelper } from "./MetadataHelper";
import { textMetadata } from "../../../tests/fixtures/textMetadata";

describe("period and comma matching", () => {
  it.each([
    ["Wells Fargo Bank, N.A.", "WELLS FARGO BANK NA"],
    ["WELLS FARGO BANK NA", "Wells Fargo Bank, N.A."],
    ["Wells Fargo Bank, N.A.", "Wells Fargo Bank, N.A."],
    ["Wells Fargo Bank N,A", "Wells Fargo Bank NA"],
    ["Wells Fargo Bank NA", "Wells Fargo Bank N,A"],
    ["Wells Fargo Bank, (N.A.)", "Wells Fargo Bank NA"],
    ["Amount 142,500.00", "Amount 14250000"],
    ["Amount 14250000", "Amount 142,500.00"],
  ])("matches %s against %s without changing metadata", (paragraph, query) => {
    const data = textMetadata(paragraph);
    const original = structuredClone(data);
    const helper = new MetadataHelper();
    helper.load(data);
    const hits = helper.search(0, query);

    expect(hits.tokens).toEqual(data.pages[0].tokens.map(token => ({
      token: token.content,
      confidence: "99%",
      polygon: token.polygon,
    })));
    expect(hits.contexts.map(context => context.content)).toEqual([paragraph]);
    expect(hits.figures).toEqual([]);
    expect(helper.highlightIndex(0, { value: query, source: query, label: "Name", ambiguous: "NO" })).toEqual(hits);
    expect(data).toEqual(original);
  });

  it("normalizes context queries and keeps text search inside the selected region", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Wells Fargo Bank, N.A. lender", "Wells Fargo Bank, N.A. recorder"));

    const hits = helper.search(0, "WELLS FARGO BANK NA", "lender AND NA");
    expect(hits.tokens.map(token => token.token)).toEqual(["Wells", "Fargo", "Bank,", "N.A."]);
    expect(hits.contexts.map(context => context.content)).toEqual(["Wells Fargo Bank, N.A. lender"]);
    expect(helper.search(0, "", "lender AND NA")).toEqual({ ...hits, tokens: [] });
    expect(helper.search(0, "WELLS FARGO BANK NA", "unmatched").tokens).toHaveLength(8);

    helper.load(textMetadata("Wells Fargo Bank NA lender", "Wells Fargo Bank NA recorder"));
    expect(helper.search(0, "", "lender AND N.A.").contexts.map(context => context.content)).toEqual(["Wells Fargo Bank NA lender"]);
  });

  it("normalizes index source and unordered value within the source region", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Wells Fargo Bank, N.A. lender", "Wells Fargo Bank, N.A. recorder"));

    const hits = helper.highlightIndex(0, {
      value: "NA BANK FARGO WELLS",
      source: "WELLS FARGO BANK NA lender",
      label: "Name",
      ambiguous: "NO",
    });
    expect(hits.tokens.map(token => token.token)).toEqual(["Wells", "Fargo", "Bank,", "N.A."]);
    expect(hits.contexts.map(context => context.content)).toEqual(["Wells Fargo Bank, N.A. lender"]);
    expect(helper.search(0, "NA BANK FARGO WELLS").tokens).toEqual([]);
  });

  it.each(["", "unmatched source"])("normalizes index value with page search for source %s", source => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Wells Fargo Bank, N.A."));

    const hits = helper.highlightIndex(0, { value: "NA BANK FARGO WELLS", source, label: "Name", ambiguous: "NO" });
    expect(hits.tokens.map(token => token.token)).toEqual(["Wells", "Fargo", "Bank,", "N.A."]);
    expect(hits.contexts).toEqual([]);
  });

  it("keeps slash separation, contractions and original token deduplication", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Trustee's substitute/successor N.A."));

    const source = "Trustee's substitute/successor NA";
    const hits = helper.search(0, source);
    expect(hits.tokens.map(token => token.token)).toEqual(["Trustee's", "substitute/successor", "N.A."]);
    expect(helper.highlightIndex(0, { value: "NA successor substitute Trustee's", source, label: "Name", ambiguous: "NO" })).toEqual(hits);
  });

  it("keeps normalization and fuzzy spelling within the existing threshold", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("N.A.", "NX"));
    expect(helper.search(0, "NA").tokens.map(token => token.token)).toEqual(["N.A."]);
    helper.load(textMetadata("Wells Fargo Bank, N.A."));
    expect(helper.search(0, "WELLS FARGX BANK NA").tokens.map(token => token.token)).toEqual(["Wells", "Fargo", "Bank,", "N.A."]);
  });

  it("keeps AND, OR and distinct positions for repeated terms", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Wells Fargo Bank, N.A."));
    expect(helper.search(0, "WELLS AND FARGO AND BANK AND NA").tokens).toHaveLength(4);
    expect(helper.search(0, "absent OR NA").tokens.map(token => token.token)).toEqual(["N.A."]);
    expect(helper.search(0, "NA NA").tokens).toEqual([]);
    helper.load(textMetadata("N.A. N,A"));
    expect(helper.search(0, "NA NA").tokens.map(token => token.token)).toEqual(["N.A.", "N,A"]);
    expect(helper.search(0, "NA NA NA").tokens).toEqual([]);
  });

  it.each(["", ".", ",", "...,,,", ". ,", "---"])("returns no terms for punctuation-only input %s", query => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Wells Fargo Bank, N.A."));
    expect(helper.search(0, query)).toEqual({ tokens: [], contexts: [], figures: [] });
    expect(helper.highlightIndex(0, { value: query, source: query, label: "Name", ambiguous: "NO" })).toEqual({ tokens: [], contexts: [], figures: [] });
  });

  it("preserves page and context boundaries and matches without context for one term", () => {
    const data = textMetadata("Wells Fargo", "Bank, N.A.");
    data.pages.push(textMetadata("Wells Fargo Bank, N.A.").pages[0]);
    const helper = new MetadataHelper();
    helper.load(data);
    expect(helper.search(0, "WELLS FARGO BANK NA").tokens).toEqual([]);
    expect(helper.search(1, "WELLS FARGO BANK NA").tokens).toHaveLength(4);
    data.pages[1].contexts = [];
    expect(helper.search(1, "NA").tokens.map(token => token.token)).toEqual(["N.A."]);
    expect(helper.search(1, "WELLS FARGO BANK NA").tokens).toEqual([]);
    expect(helper.highlightIndex(1, { value: "NA BANK FARGO WELLS", source: "", label: "Name", ambiguous: "NO" }).tokens).toHaveLength(4);
  });
});
