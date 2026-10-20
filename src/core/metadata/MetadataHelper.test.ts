import { describe, expect, it } from "vitest";
import { MetadataHelper } from "./MetadataHelper";

describe("MetadataHelper", () => {
  it("selects active-page tokens with context", () => {
    const helper = new MetadataHelper();
    helper.load(metadata());

    const hits = helper.search(0, "Alpha");
    const groups = helper.exportGroups(0, hits.tokens);

    expect(hits.tokens.map((token) => token.token)).toEqual(["Alpha"]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["Alpha Beta"]);
    expect(groups).toEqual([
      {
        value: {
          token: ["ALPHA"],
          context: ["ALPHA BETA"],
          kind: ["BODY"],
        },
      },
    ]);
  });

  it("keeps hits scoped to the requested page", () => {
    const helper = new MetadataHelper();
    helper.load(metadata());

    expect(helper.search(0, "Gamma").tokens).toEqual([]);
    expect(helper.search(1, "Gamma").tokens.map((token) => token.token)).toEqual(["Gamma"]);
  });

  it("returns exact and fuzzy token matches together", () => {
    const helper = new MetadataHelper();
    helper.load(cascadeMetadata());

    const hits = helper.search(0, "Record");

    expect(hits.tokens.map((token) => token.token)).toEqual(["Record", "Recorder"]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["Record opening primary", "Recorder openings"]);
  });

  it("returns fuzzy token matches when no exact token exists", () => {
    const helper = new MetadataHelper();
    helper.load(cascadeMetadata());

    const hits = helper.search(0, "Sourxe");

    expect(hits.tokens.map((token) => token.token)).toEqual(["Source", "Source"]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["Source opening", "Source openings"]);
  });

  it("returns exact and fuzzy context matches together", () => {
    const helper = new MetadataHelper();
    helper.load(cascadeMetadata());

    const hits = helper.search(0, "Source", "opening");

    expect(hits.tokens.map((token) => token.token)).toEqual(["Source", "Source"]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["Record opening primary", "Recorder openings", "Source opening", "Source openings"]);
  });

  it("returns fuzzy context matches when no exact context exists", () => {
    const helper = new MetadataHelper();
    helper.load(cascadeMetadata());

    const hits = helper.search(0, "Record", "primry");

    expect(hits.tokens.map((token) => token.token)).toEqual(["Record"]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["Record opening primary"]);
  });

  it("returns metadata page dimensions", () => {
    const helper = new MetadataHelper();
    helper.load(metadata());

    expect(helper.pageSize(0)).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("adds overlapping point contexts by geometry", () => {
    const helper = new MetadataHelper();
    helper.load(overlapMetadata());

    const hits = helper.getElement(0, 34, 20);

    expect(hits.tokens.map((token) => token.token)).toEqual(["Name"]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["The registrant Name filed", "Document Number:"]);
  });

  it("keeps direct point contexts when no token is clicked", () => {
    const helper = new MetadataHelper();
    helper.load(overlapMetadata());

    const hits = helper.getElement(0, 80, 20);

    expect(hits.tokens).toEqual([]);
    expect(hits.contexts.map((context) => context.content)).toEqual(["The registrant Name filed", "Document Number:"]);
  });

  it("returns page-local figures", () => {
    const helper = new MetadataHelper();
    helper.load(metadata());

    const hits = helper.getElement(0, 82, 82);

    expect(hits.figures).toEqual([
      {
        polygon: [75, 75, 95, 75, 95, 95, 75, 95],
      },
    ]);
  });
});

function metadata() {
  return {
    pages: [
      {
        pageNumber: 1,
        width: 100,
        height: 200,
        tokens: [
          {
            content: "Alpha",
            confidence: 0.98,
            polygon: [10, 10, 40, 10, 40, 30, 10, 30],
          },
          {
            content: "Beta",
            confidence: 0.98,
            polygon: [45, 10, 70, 10, 70, 30, 45, 30],
          },
        ],
        contexts: [
          {
            content: "Alpha Beta",
            role: "body",
            polygon: [5, 5, 75, 5, 75, 35, 5, 35],
          },
        ],
        figures: [
          {
            polygon: [75, 75, 95, 75, 95, 95, 75, 95],
          },
        ],
      },
      {
        pageNumber: 2,
        width: 100,
        height: 200,
        tokens: [
          {
            content: "Gamma",
            confidence: 0.98,
            polygon: [10, 10, 50, 10, 50, 30, 10, 30],
          },
        ],
        contexts: [
          {
            content: "Gamma",
            role: "body",
            polygon: [5, 5, 55, 5, 55, 35, 5, 35],
          },
        ],
        figures: [],
      },
    ],
  };
}

function overlapMetadata() {
  return {
    pages: [
      {
        pageNumber: 1,
        width: 100,
        height: 100,
        tokens: [
          {
            content: "Name",
            confidence: 0.98,
            polygon: [20, 10, 40, 10, 40, 30, 20, 30],
          },
        ],
        contexts: [
          {
            content: "The registrant Name filed",
            role: "body",
            polygon: [5, 5, 95, 5, 95, 40, 5, 40],
          },
          {
            content: "Document Number:",
            role: "body",
            polygon: [30, 5, 95, 5, 95, 40, 30, 40],
          },
        ],
        figures: [],
      },
    ],
  };
}

function cascadeMetadata() {
  return {
    pages: [
      {
        pageNumber: 1,
        width: 100,
        height: 100,
        tokens: [
          {
            content: "Record",
            confidence: 0.98,
            polygon: [10, 10, 30, 10, 30, 20, 10, 20],
          },
          {
            content: "Recorder",
            confidence: 0.98,
            polygon: [10, 30, 40, 30, 40, 40, 10, 40],
          },
          {
            content: "Source",
            confidence: 0.98,
            polygon: [50, 10, 70, 10, 70, 20, 50, 20],
          },
          {
            content: "Source",
            confidence: 0.98,
            polygon: [50, 30, 70, 30, 70, 40, 50, 40],
          },
        ],
        contexts: [
          {
            content: "Record opening primary",
            role: "body",
            polygon: [5, 5, 45, 5, 45, 25, 5, 25],
          },
          {
            content: "Recorder openings",
            role: "body",
            polygon: [5, 25, 45, 25, 45, 45, 5, 45],
          },
          {
            content: "Source opening",
            role: "body",
            polygon: [45, 5, 75, 5, 75, 25, 45, 25],
          },
          {
            content: "Source openings",
            role: "body",
            polygon: [45, 25, 75, 25, 75, 45, 45, 45],
          },
        ],
        figures: [],
      },
    ],
  };
}
