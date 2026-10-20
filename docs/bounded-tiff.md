# Bounded TIFF viewing

TIFF viewing opens the document once in the package worker, counts its directories,
and decodes the requested page first. After display, it prefetches the next page and
the previous page, then stops. Navigation and visible thumbnails request missing
pages through the same serialized decode-and-save queue. Obsolete queued navigation
requests are skipped. Closing, clearing, or replacing the document terminates its
workers and invalidates pending work.

Decoded PNGs remain in IndexedDB for navigation, restore, editing, and export.
They are not duplicated in the viewer's memory cache. Without a session store,
the cache retains at most three PNGs and 64 MiB of encoded data; eviction reloads
from the original TIFF. An oversized PNG can be displayed without being cached.
The byte ceiling limits the encoded cache, not total browser memory. The original
TIFF, decoder heap, active page, and canvas working storage are additional.

Thumbnails retain only the existing visible/buffered range and are rendered one
at a time. TIFF imports preserve their full-document contract but acknowledge each
page only after processing finishes, preventing an accumulating pixel queue.
Export materializes missing original pages in document order and preserves stored
inserted pages. Metadata and page identities remain independent of decoded PNGs.
PDF, PNG, and JPEG decoding retain their existing full-document contract. The
downloader still retrieves the whole file.

## Historical window measurements

Edge measurements use a synthetic 20-page TIFF made from the existing 2540 x 3312
TIFF fixture, the real WASM decoder, PNG conversion, and IndexedDB. Three trials
compare requested-page-only, one neighbor on each side, and two on each side.
Navigation follows pages 11, 9, 12, and 10 after opening page 10. Values below are
medians; they are observations on this workstation, not timing assertions.
Display timings wait for the image to decode and two animation frames.

| Initial pages | Prefetch time | Adjacent navigation | Prefetch plus navigation |
| --- | ---: | ---: | ---: |
| 1 | 0 ms | 492 ms | 1666 ms |
| 3 | 556 ms | 200 ms | 1683 ms |
| 5 | 1079 ms | 211 ms | 1950 ms |

The selected three-page window provides warm adjacent navigation with less
speculative work than five pages. The 64 MiB cache ceiling is a safety budget,
not a claimed performance optimum. Its byte and page limits have regression tests.

The integrated 20-page Edge test displayed page 10 in 600 ms, processed three
initial pages, and observed one outstanding transferred pixel
buffer: 33,649,920 bytes (32.1 MiB). This is not total process memory. The test also
checks sparse restore, previously undecoded navigation, thumbnails, and TIFF export.
The final run navigated to its cached neighbor in 202 ms.

These timings are historical observations, not assertions in the current suite.

## Reproducible verification

- `npm test`: `DocumentDecoder.test.ts`, `workers/tiffWorker.test.ts` and
  `AuroraLens.test.ts` cover directory selection, transfer acknowledgements,
  raster limits, cache bounds, sparse restoration, page identities and edits.
- `npm run test:production`: `tests/production/decoding.spec.ts` builds an actual
  consumer bundle and checks TIFF, PDF, PNG and JPEG workers. It also opens a
  20-page TIFF built from the real fixture's first page, asserts the initial
  directory sequence `[9, 10, 8]`, verifies a single pending page decode,
  restores sparse storage, navigates to an undecoded page and exports all pages.
- `npm run test:browser`: Edge selection tests use original text and geometry
  fixtures at desktop and narrow widths.

Index and Intake resolve the same rebuilt local Lens package. The document host
resolves those workspace packages. No registry publication is required.
