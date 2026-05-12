import { describe, expect, it } from "vitest";
import { ACTIVE_VIEWER_SESSION_ID, validateViewerSession } from "./viewerSessionStore";

describe("viewerSessionStore", () => {
  it("validates a persisted viewer session", () => {
    const fileBlob = new Blob(["tiff"], { type: "image/tiff" });
    const page = {
      pageId: "page-1",
      documentId: ACTIVE_VIEWER_SESSION_ID,
      sequenceNumber: 1,
      sourcePageIndex: 0,
      updatedAt: 1,
    };

    expect(validateViewerSession({
      document: {
        id: ACTIVE_VIEWER_SESSION_ID,
        fileName: "sample.tiff",
        fileType: "image/tiff",
        fileBlob,
        currentPageId: "page-1",
        updatedAt: 1,
      },
      pages: [page],
      currentPage: page,
    })).toEqual({
      document: {
        id: ACTIVE_VIEWER_SESSION_ID,
        fileName: "sample.tiff",
        fileType: "image/tiff",
        fileBlob,
        currentPageId: "page-1",
        updatedAt: 1,
      },
      pages: [page],
      currentPage: page,
    });
  });

  it("rejects corrupt viewer sessions", () => {
    expect(() => validateViewerSession({
      document: {
        id: ACTIVE_VIEWER_SESSION_ID,
        fileName: "corrupt.tiff",
        fileType: "image/tiff",
        currentPageId: "page-1",
        updatedAt: 1,
      },
      pages: [],
      currentPage: null,
    })).toThrow("Stored viewer session is invalid.");
  });
});
