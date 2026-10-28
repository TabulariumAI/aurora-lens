import { describe, expect, it } from "vitest";
import { MetadataRepository } from "./MetadataRepository";
import { ACTIVE_VIEWER_SESSION_ID, type ViewerPageRecord } from "../session/viewerSessionStore";

const pages: ViewerPageRecord[] = [0, 1].map(index => ({
  pageId: `page-${index + 1}`,
  documentId: ACTIVE_VIEWER_SESSION_ID,
  sequenceNumber: index + 1,
  sourcePageIndex: index,
  updatedAt: 1,
}));

describe("MetadataRepository page names", () => {
  const repository = new MetadataRepository();

  it.each([null, { pages: [{}, {}] }])("returns no mapped names when the schema is absent (%j)", metadata => {
    expect(repository.pageMap(metadata, pages)).toEqual(new Map());
  });

  it("preserves an empty names schema", () => {
    expect(repository.pageMap({ pages: [{}, {}], pageMap: {} }, pages)).toEqual(new Map());
    expect(repository.split({ pages: [{}, {}], pageMap: {} }, pages)).toEqual([
      { pageId: "page-1", metadata: { pageNames: [] } },
      { pageId: "page-2", metadata: { pageNames: [] } },
    ]);
  });

  it("keeps names schema markers on pages without a mapped name", () => {
    const metadata = { pages: [{}, {}], pageMap: { "Exhibit-A": 0 } };
    expect(repository.pageMap(metadata, pages)).toEqual(new Map([["Exhibit-A", "page-1"]]));
    expect(repository.split(metadata, pages)).toEqual([
      { pageId: "page-1", metadata: { pageNames: ["Exhibit-A"] } },
      { pageId: "page-2", metadata: { pageNames: [] } },
    ]);
  });

  it("does not introduce name markers when the schema is absent", () => {
    expect(repository.split({ pages: [{}, {}] }, pages)).toEqual([
      { pageId: "page-1", metadata: {} },
      { pageId: "page-2", metadata: {} },
    ]);
  });
});
