# Aurora Lens

Aurora Lens is a framework-agnostic document viewer from Tabularium AI. It decodes supported documents, renders normalized raster pages, overlays Tabularium AI metadata, supports selection, copy, search, zoom, and thumbnails, and stores decoded pages for fast navigation.

Aurora, the proprietary Tabularium AI runtime, is not included in this package.

## Install

```sh
npm install @tabulariumai/aurora-lens
```

## Usage

```tsx
import { useRef } from "react";
import { ReactViewer } from "@tabulariumai/aurora-lens/react";
import type { AuroraLens, PageSizeConfig } from "@tabulariumai/aurora-lens";

export function Viewer({ pageSize }: { pageSize: PageSizeConfig }) {
  const lensRef = useRef<AuroraLens | null>(null);

  return (
    <ReactViewer
      ref={lensRef}
      pageSize={pageSize}
      allowEdit={true}
      onError={(error) => console.error(error)}
    />
  );
}
```

## Document Decoding

The package owns document detection and decoding through `decodeDoc(file, { page, viewMode })`. Supported input formats are TIFF/TIF, PDF, PNG, and JPG/JPEG.

PDF decoding uses one renderer for the document worker and the public `decodePdfFile(file, options)` and `decodePdfBytes(bytes, sourceName, options)` APIs. The public helpers default to 300 DPI and apply the default export raster limits; view decoding uses the configured view DPI and limits. PDF pages scale down to fit these limits. TIFF, PNG and JPEG pages exceeding their configured view limits are rejected before a canvas pixel buffer is allocated.

The package supplies its PDF worker and font resources. `configurePdfWorker(url)` and `options.workerSrc` remain available for the public PDF helpers; consumers of `AuroraLens` do not need to configure PDF.js separately.

TIFF viewing decodes the requested page first, prefetches one neighbor on each side, and loads other pages on demand. IndexedDB retains decoded PNGs for restore, editing, and export; RAM retention and thumbnail processing are bounded. See [bounded TIFF viewing](docs/bounded-tiff.md) for the limits, measurements, and verification.

## Session Restoration

Pass the backend `sessionId` in viewer options when displaying a session-owned document. Lens persists it with the document and restores only an exact match. Missing or different ownership is a cache miss: Lens awaits deletion of the stored document before returning `false`, so the host can request the correct package. `close()` preserves same-session storage. Intake and standalone viewers omit `sessionId` and restore only documents that also omit it.

## Viewer Config

The host supplies accepted page formats and tolerance through the required `pageSize` viewer option. In document_web, `src/orchestration/config/appConfig.ts` owns this policy; Intake and Index pass it to Lens. Lens applies the same policy to initial imports, added pages, and lazy TIFF decoding.

`readViewerConfig()` and `saveViewerConfig(config)` persist only view raster and export settings. Saved formats and tolerance are ignored and omitted when configuration is saved. Saving settings preserves the open document, its page order, page identities, metadata and dirty state. View raster settings apply when files are subsequently opened or added, and to uncached TIFF pages decoded on demand. Export settings apply to the next export.

## TIFF Export

`await lens.exportTiff(onProgress)` exports the current page order using the stored export configuration. Raster processing and TIFF encoding run in a module worker with `OffscreenCanvas`.

The optional callback receives `ExportProgress`: `{ phase: "pages" | "finalizing", completed: number, total: number }`. Page counts advance only after successful encoding. `finalizing` means all pages are encoded and the TIFF is being assembled; completion is the resolved `Blob`, not the last page count. Calling `close()`, `clear()`, or opening another document aborts an active export and releases its worker.

## Metadata

Aurora Lens renders supplied text and geometry when the host calls `loadMetadata(metadata)`. Load metadata before opening its document, or after that document has opened. Opening another document clears the previous metadata unless new metadata was supplied for it. `clear()` also removes metadata.

When switching to a document that does not have matching metadata, call `clear()` before `decodeDoc()` so metadata from the previous document cannot be reused by page index.

```ts
lensRef.current?.loadMetadata(metadata);
await lensRef.current?.decodeDoc(fileWithMetadata, { page: 1, viewMode: "page" });

lensRef.current?.clear();
await lensRef.current?.decodeDoc(fileWithoutMetadata, { page: 1, viewMode: "page" });
```

See [docs/metadata-schema.md](docs/metadata-schema.md).

### Keyboard selection

Pages with selectable metadata have one tab stop. Arrow keys move focus through OCR tokens in source order, followed by figures. Space selects or deselects the focused item without clearing other selections. Shift+Arrow replaces the selection with the range from its anchor to the focused item; reversing direction shrinks that range. Tab and Shift+Tab leave the document. Visible instructions remain below the page, and navigation pans zoomed content to keep the focused item visible.

The page exposes named options and their selected state to assistive technologies. The focus outline is separate from selection highlighting. Pointer selection and keyboard selection share the same selection state, contexts, clipboard and export results; existing pointer drawing, Ctrl deselection, zoom and pan remain available.

Navigation methods return promises. Failures are reported through `onError` and reject the returned promise; UI event handlers must consume the rejection. `close()` releases window listeners, animation frames and workers while preserving stored session data. `clear()` clears the view immediately; opening or restoring a document waits for its pending storage deletion.

From a source checkout, `npm test` verifies package behavior. `npm run test:browser` runs the selection tests in Edge at desktop and narrow widths. `npm run test:production` builds a production consumer and verifies emitted decoding workers and both public PDF helpers in Edge. See [verification results](docs/verification.md) for the complete review and consumer checks.

## Development

```sh
npm install
npm test
npm run build
npm pack --dry-run
```

## Public Repository Notes

This package includes the document decoding module used by the viewer.

Generated build output, Playwright reports, test results, and local environment files are ignored by Git. Source, tests, documentation, and package metadata are the public repository surface.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Page-size rejections use `LensError` with code `page_size` and `details` containing `sourceName`, `pageNumber`, pixel `width` and `height`, the active `tolerance`, and the minimum `requiredTolerance` calculated from the configured matching rules. Hosts can request explicit confirmation before retrying with a document-scoped policy.
