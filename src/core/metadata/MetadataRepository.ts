import type { ViewerPageRecord } from "../session/viewerSessionStore";

interface MetadataRoot {
  pages: unknown[];
  pageMap?: Record<string, number>;
}

export interface PageMetadataRecord {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  metadata: unknown;
}

export class MetadataRepository {
  pageMap(pageMetadata: unknown | null, pages: ViewerPageRecord[]): Map<string, string> {
    const result = new Map<string, string>();
    const map = pageMetadata === null ? undefined : this.root(pageMetadata).pageMap;
    if (map !== undefined) {
      if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("AuroraLens: pageMap must map names to page indexes.");
      for (const [name, index] of Object.entries(map)) {
        if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error("AuroraLens: pageMap index is outside the document.");
        result.set(name, pages[index].pageId);
      }
    }
    return result;
  }

  split(pageMetadata: unknown, pages: ViewerPageRecord[]): PageMetadataRecord[] {
    const metadata = this.root(pageMetadata);
    return pages
      .map((page) => ({
        pageId: page.pageId,
        metadata: metadata.pages[page.sourcePageIndex] === undefined ? undefined : metadata.pageMap === undefined
          ? metadata.pages[page.sourcePageIndex]
          : { ...metadata.pages[page.sourcePageIndex] as object, pageNames: Object.entries(metadata.pageMap).filter(([, index]) => index === page.sourcePageIndex).map(([name]) => name) },
      }))
      .filter((page) => page.metadata !== undefined);
  }

  private root(pageMetadata: unknown): MetadataRoot {
    const metadata = pageMetadata as MetadataRoot;
    if (!Array.isArray(metadata.pages)) {
      throw new Error("AuroraLens.loadMetadata: metadata must include pages.");
    }
    return metadata;
  }
}
