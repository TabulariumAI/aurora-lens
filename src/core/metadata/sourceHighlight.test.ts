import { describe, expect, it } from "vitest";
import { MetadataHelper } from "./MetadataHelper";
import fixture from "../../../tests/fixtures/party-selection.json";
import { textMetadata } from "../../../tests/fixtures/textMetadata";

describe("source highlighting with punctuation", () => {
  it.each([
    [fixture.indexes[0], ["Jose", "L.", "Salinas,"]],
    [fixture.indexes[1], ["Ruth", "W.", "Garner."]],
  ] as const)("keeps the actual source paragraph and name tokens for %j", (index, expected) => {
    const helper = new MetadataHelper();
    helper.load(fixture.metadata);
    const context = fixture.metadata.pages[0].contexts.find(context => context.content.includes(index.source))!;
    expect(context).toBeDefined();

    const hits = helper.highlightIndex(0, index);

    expect(hits.contexts.map(context => context.content)).toEqual([context.content]);
    expect(hits.tokens.map(token => token.token)).toEqual(expected);
    expect(hits.tokens.every(token => context.polygon[1] <= token.polygon[1] && token.polygon[5] <= context.polygon[5])).toBe(true);
    expect(hits.figures).toEqual([]);
  });

  it.each(["ordered", "unordered"])("matches contractions and compound tokens once in %s search", mode => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Trustee's substitute/successor signs.", "Trustee unrelated successor"));
    const text = "Trustee's substitute/successor";
    const hits = mode === "ordered"
      ? helper.search(0, text)
      : helper.highlightIndex(0, { label: "Name", value: "successor substitute Trustee's", source: text, ambiguous: "NO" });

    expect(hits.tokens.map(token => token.token)).toEqual(["Trustee's", "substitute/successor"]);
    expect(hits.contexts.map(context => context.content)).toEqual(["Trustee's substitute/successor signs."]);
  });

  it("matches initials without selecting words containing the same letter", () => {
    const helper = new MetadataHelper();
    helper.load(textMetadata("Lucy Clerk Mail Jose L. Salinas"));

    expect(helper.highlightIndex(0, { label: "Name", value: "SALINAS JOSE L", source: "", ambiguous: "NO" }).tokens.map(token => token.token))
      .toEqual(["Jose", "L.", "Salinas"]);
  });
});
