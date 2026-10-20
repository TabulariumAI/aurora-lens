# Implement `isDirty()` Public API

Status: implemented in `AuroraLens`, exposed through `ViewerReady`, and covered by the cases below.

## Objective

Add a public API method named `isDirty()` that reports whether the current document page structure differs from the original opened or restored state.

## Public Contract

```ts
viewer.isDirty(): boolean
```

Add the method to `ViewerReady`.

Expose it from `AuroraLens` as a public instance method.

## Behavior

Return `false` when:

- no document is open
- a document is open but pages match the original baseline exactly
- pages were added, removed, or reordered, but the final state returned to the exact original ordered page identity list

Return `true` when:

- one or more pages were added
- one or more original pages were removed
- original pages were reordered
- any combination of add, remove, or reorder produces a final page identity/order different from the original baseline

## Internal State

Add private baseline state to `AuroraLens`:

```ts
private baselinePageIds: string[] = [];
```

This baseline stores the ordered list of stable package-owned page IDs from the original document state.

## Baseline Capture

Set the baseline after the original page records are created or restored.

In `decodeDoc()`:

- After `this.sessionPages` is finalized from `resetDocument(...)`, capture:

```ts
this.baselinePageIds = this.pageIds();
```

This must happen after session-store normalization, because `resetDocument()` returns the authoritative page records.

In `restoreSession()`:

- After assigning `this.sessionPages = session.pages`, capture:

```ts
this.baselinePageIds = this.pageIds();
```

In `clearView()`:

- Reset baseline:

```ts
this.baselinePageIds = [];
```

## Dirty Check

Add this public method on `AuroraLens`:

```ts
isDirty(): boolean {
  const currentPageIds = this.pageIds();

  if (!this.baselinePageIds.length || !currentPageIds.length) {
    return false;
  }

  if (currentPageIds.length !== this.baselinePageIds.length) {
    return true;
  }

  return currentPageIds.some((pageId, index) => pageId !== this.baselinePageIds[index]);
}
```

This is intentionally based on page identity/order only. It must not use timestamps, sequence numbers, source page indexes, metadata, blobs, current page, zoom, viewer config, or selection state.

## ViewerReady Wiring

Update `ViewerReady` in `core/types.ts`:

```ts
isDirty(): boolean;
```

`ReactViewer` passes the `AuroraLens` instance directly to `onReady`. Its public `isDirty()` method satisfies `ViewerReady`; there is no separate ready object or forwarding wrapper.

## Tests

Tests are in `src/core/AuroraLens.test.ts`.

Required coverage:

- new viewer/no document returns `false`
- open document returns `false`
- add page returns `true`
- remove original page returns `true`
- reorder pages returns `true`
- reorder pages back to original order returns `false`
- add page then remove that added page returns `false`
- remove page then re-add is still `true`, because the new page has a different page ID and is not the original page identity
- restored session baseline returns `false` immediately after restore

## Design Notes

Use existing `pageId` as the identity source. It is already the stable internal document-page identifier used by add/remove/reorder/session persistence.

Do not create a new diff model, expose page IDs publicly, or persist the baseline separately. A restored session becomes the clean baseline because restore represents the document state being loaded as the starting state.

Do not include metadata, config, current-page, zoom, viewer config, or selection changes in `isDirty()`. The requested scope is only added, removed, or reordered pages.
