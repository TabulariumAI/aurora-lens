import type { ViewerPageRecord } from "../session/viewerSessionStore";

interface MetadataRoot {
  pages: unknown[];
}

export interface PageMetadataRecord {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  metadata: unknown;
}

export class MetadataRepository {
  split(pageMetadata: unknown, pages: ViewerPageRecord[]): PageMetadataRecord[] {
    const metadata = this.root(pageMetadata);
    return pages
      .map((page) => ({
        pageId: page.pageId,
        metadata: metadata.pages[page.sourcePageIndex],
      }))
      .filter((page) => page.metadata !== undefined);
  }

  pageRoot(pageIndex: number, pageMetadata: unknown) {
    const pages: unknown[] = [];
    pages[pageIndex] = pageMetadata;
    return {
      pages,
    };
  }

  private root(pageMetadata: unknown): MetadataRoot {
    const metadata = pageMetadata as MetadataRoot;
    if (!Array.isArray(metadata.pages)) {
      throw new Error("AuroraLens.loadMetadata: metadata must include pages.");
    }
    return metadata;
  }
}
