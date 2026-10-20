# Aurora Lens verification

Verified on 2026-10-17 across Aurora Lens, its Index and Intake consumers, and document_web. No unresolved findings remain in the reviewed flow.

## Refactor results

- Production workers use static worker constructors that bundlers recognize. A production browser test exercises the emitted TIFF, PDF, PNG and JPEG workers and their resource URLs.
- `decodePdfFile()`, `decodePdfBytes()`, `configurePdfWorker()` and their public types remain available. The public helpers and document worker use one PDF renderer. The production test compares their complete rendered pixel hashes at the same DPI.
- Viewing, raster import and TIFF export use one blob-to-pixel reader. Polygon hit testing has one shared implementation. Duplicate page types, unused validation, redundant casts, a metadata forwarding wrapper and unused consumer compatibility handling were removed.
- PNG/JPEG raster limits are checked before canvas allocation. Bitmaps and temporary read/render canvases are released on success and failure. PDF rendering applies raster limits and destroys its loading task on every exit.
- Closing releases the window resize listener and scheduled page rendering. Late clipboard completion cannot change a cleared or replaced viewer's state.
- Reordering commits storage before changing the displayed order. Thumbnail edit failures reach `onError`; consumer UI events consume navigation rejections after Lens reports them.
- Opening or restoring waits for pending storage deletion from `clear()`. Failed decoder workers are terminated and discarded before retry.
- Saving configuration preserves the open document's page identities, order, metadata and dirty baseline. Decode settings apply to later opens, additions and uncached TIFF decoding; export settings apply to the next export.
- Browser tests resolve the actual consumer import of Lens. Obsolete optimized-dependency paths, visible-header assertions that contradicted `showHeader: false`, outdated labels and full-document raster-count expectations were corrected.
- Unit tests release created viewers between cases. The previously failing dropped-TIFF test passes in the complete suite without increasing its timeout.

## Architecture and implementation review

| Check | Result |
| --- | --- |
| Implementation plan | `isDirty()` matches the page identity/order plan; all nine required cases are covered. Configuration saving preserves that baseline. |
| Ownership and layers | Lens coordinates decoding, selection, rendering, persistence and export. IndexedDB access remains in `core/session/viewerSessionStore.ts`. Consumers use the package's public API. |
| Manager and DataHub rules | No backend manager coordination or DataHub repository access exists in the reviewed frontend flow. No backend files were changed. |
| Dependency structure | 35 production modules, no runtime import cycles. Shared decoding types do not depend on the public PDF facade. |
| Duplicate solutions | One PDF renderer, one blob-to-pixel reader, one polygon hit-test implementation and one metadata search implementation serve their callers. |
| Naming and public contracts | PDF APIs are preserved; navigation methods declare their actual promise results. No compatibility aliases or future-support stubs were added. |
| Speculation and defensive code | Removed the unused `isDirty` capability probe and dead numeric-page validation. Existing input validation and documented configuration defaults remain. |
| Text matching | Matching uses supplied text and geometry through the shared Fuse search flow. No producer-specific correction rules or terminology remain in Lens source and documentation. |
| Documentation | README, metadata schema, bounded TIFF verification and the dirty-state plan agree with implementation. |

The supplied `image.json` was read directly and its first page compared with `tests/fixtures/party-selection.json`: they match. Index Highlight returns one three-token name occurrence and one context for each of `SALINAS JOSE L` and `GARNER RUTH W`. Text Search returns all complete exact and fuzzy occurrences; Highlight ranks complete values, source-term coverage and Fuse score, retaining metadata order on ties.

## Search and index Highlight verification (2026-10-18)

Regression tests were updated and run before implementation. They reproduced multiple index results and suppressed fuzzy Search results. The final shared matcher keeps exact and fuzzy matches, while Highlight ranks one occurrence by complete value, distinct source-term coverage and Fuse score. Tests also cover ordered source scores, partial-source costs, repeated terms, overlapping regions, punctuation, exports, replacement and additive selection, and page boundaries.

| Check | Result |
| --- | --- |
| Lens unit suite | 20 files, 307 tests passed |
| Index unit suite | 68 files, 710 tests passed |
| Lens Edge browser suite | 10 passed across desktop and narrow viewports |
| Index Edge visual suite | 7 passed |
| document_web Edge workflows and document viewer | 29 workflows and authentication setup passed; snapshot updates disabled |
| document_web Chromium visual baselines | 3 workflows and authentication setup passed |
| Types, build and boundaries | Lens type check and build; Index type check and boundary gate; document_web type check, architecture gate and build passed |
| Rendered verification | Index Highlight, Search, host loader, desktop spacing, preview and narrow dialog screenshots inspected |
| Source gates | Superseded search contracts removed; changed files have no trailing whitespace |

The matching review reuses normalized page tokens and prepared query results within each request. Complete source matches also reuse their existing coverage and ordered score. Public APIs, package ownership, rendering and host orchestration remain unchanged. Additional exhaustive tests verify partial-source assignment costs and coverage of normalized positions inside compound tokens.

The approved `document_web` host-test migration updates the document-viewer suite to the current loader text, formatted aspect labels, complete Add Index request payload, host Close control and responsive panel sizing. The empty-results assertion is scoped to the Type suggestions list. Existing Chromium baselines were refreshed and missing Edge baselines added after rendered review. Snapshot thresholds and test timeouts were preserved. The complete document-viewer suite and six focused host workflows pass together in Edge. No production host UI or orchestration was changed.

The responsive host run emits an existing React warning about mixed `flex` and `flexBasis` styles. That production host styling is outside this matcher and test migration; the rendering assertions and architecture gate pass.

The earlier full-workspace verification below records the 2026-10-17 checks.

## Verification results

| Project/check | Result |
| --- | --- |
| Lens unit suite | 19 files, 266 tests passed |
| Index unit suite | 68 files, 710 tests passed |
| Intake unit suite | 31 files, 319 tests passed |
| document_web unit suite | 158 files, 1,071 tests passed |
| Type checks | All four projects passed; Lens also passed unused-local and unused-parameter checks |
| Builds | Lens, Index, Intake, document_web and the production fixture passed |
| Architecture gates | Index and Intake boundary gates and document_web architecture gate passed |
| Host lint | Full document_web ESLint check passed |
| Lens Edge selection tests | 6 passed, covering desktop and narrow viewports |
| Production Edge tests | 2 passed, including 20-page sparse TIFF restoration, bounded decoding, configuration preservation and export |
| Host Edge workflows | 32 passed, including authentication setup, session restoration, page-size tolerance, editing, export, settings and metadata selection |
| Diff whitespace | Changed consumer and host files passed `git diff --check` |

The installed browser runtime advisory lookup returned no advisories for `fuse.js@7.5.0`, `pdfjs-dist@6.3.289`, `react@19.3.0`, `react-dom@19.3.0` and `scheduler@0.28.0`. This is an installed-version advisory check, not a penetration test.

Reproduce from a source checkout:

```sh
# aurora-lens
npm run lint
npm test
npm run test:browser
npm run test:production

# aurorra_index
npm run typecheck
npm run lint:boundary
npm run build
npm run test:vitest

# aurorra_intake
npm run typecheck
npm run lint:boundary
npm run build
npm test

# document_web
npm run typecheck
npm run lint:architecture
npm run lint
npm run build
npm test
npx playwright test tests/playwright/image-session.functional.spec.ts tests/playwright/image-tolerance.functional.spec.ts tests/playwright/intake-thumbnails.functional.spec.ts tests/playwright/intake-export.functional.spec.ts tests/playwright/intake-preparation.functional.spec.ts tests/playwright/metadata-preview.functional.spec.ts tests/playwright/metadata-token-search.functional.spec.ts tests/playwright/metadata-recognition-preview.functional.spec.ts tests/playwright/intake.functional.spec.ts --project=edge --workers=2
```

Build Lens before running consumer checks. Do not rebuild it concurrently with consumer checks: its build replaces `dist`, which linked consumers read.

## PDF image decoder verification (2026-10-18)

The shared PDF renderer enables WASM image decoding through its existing `PdfBinaryDataFactory`, with `useWorkerFetch: false`. This loads bundled image decoder assets through the same URL resolution used for binary resources. The document worker and public PDF APIs continue to use one renderer; no consumer orchestration or UI changes are required.

Tests added before implementation reproduced blank JBIG2 and CCITT pages. Synthetic three-page fixtures now verify visible pixels, matching worker and public API pixel hashes, emitted WASM requests, thumbnail selection, next/previous page indexes, viewer height, reopening and IndexedDB restoration at desktop and narrow widths. Decoder warnings, JavaScript decoder fallback requests and failed resource responses fail the production decoding checks. PDF.js's existing successful worker setup notice is excluded from warning assertions.

The package unit suite, type check, build, development Edge suite and production Edge suite pass. The existing TIFF, text PDF, PNG and JPEG production checks remain included. The reported PDF was also checked through Intake's actual linked import at 1440px and 375px, including navigation, refresh, cancel and reselection; its contents are not included in the test fixtures.

Build Lens before checking linked consumers. Restart an already-running consumer development server after rebuilding if it still serves the previous transformed dependency: this verification confirmed that the on-disk package and the running server could otherwise expose different PDF configurations.

## Review scores

These are review estimates comparing the original code reviewed in this task with the final implementation. Coverage scores are not measured coverage percentages.

| Category | Before | After |
| --- | ---: | ---: |
| Efficiency | 5 | 8 |
| Professionalism and readability | 5 | 9 |
| Maintainability | 5 | 9 |
| Safety and security | 5 | 8 |
| Stability and error handling | 4 | 9 |
| Scalability | 4 | 8 |
| LLM-specific compliance | 4 | 10 |
| Architecture compatibility | 6 | 9 |
| Test coverage | 5 | 8 |
| Test quality | 5 | 9 |
| Regression safety | 4 | 9 |

For compliance, 10 means no observed violations. For regression safety, higher means lower regression risk. Security and coverage remain below 10 because advisory checks and passing tests do not establish complete security or complete path coverage.
