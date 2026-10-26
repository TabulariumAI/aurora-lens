# Tabularium AI Metadata

Aurora Lens accepts page text and regions as a JSON object with a `pages` array. Search and highlighting use the supplied text, token order, and polygons. The same schema applies regardless of how the text was obtained or what the document describes.

Decode, navigation, and index highlighting accept page names (strings or numbers). The optional `pageMap` maps each name to a zero-based decoded-page position. Without a supplied map, Lens creates `{"1":0,"2":1,...}` from the decoded page count. Unmapped numeric names use that generated mapping. `ViewerState.pageIndex` and `resolvePage(name)` return zero-based positions.

```json
{
  "pageMap": { "26": 0 },
  "pages": [
    {
      "pageNumber": 26,
      "width": 850,
      "height": 1100,
      "tokens": [
        {
          "content": "abcd",
          "confidence": 0.98,
          "polygon": [120, 80, 220, 80, 220, 116, 120, 116]
        }
      ],
      "contexts": [
        {
          "role": "title",
          "content": "Abcd",
          "polygon": [110, 70, 260, 70, 260, 130, 110, 130]
        }
      ],
      "figures": [
        {
          "polygon": [300, 200, 520, 200, 520, 380, 300, 380]
        }
      ]
    }
  ]
}
```

## Fields

`pageMap`: Optional object mapping exact page names to zero-based decoded-page positions. Names are preserved, including leading zeros. Entries are saved with page metadata and restored by page identity.

`pages`: Required array. Each item describes metadata for one decoded page.

Each page supplies `pageNumber`, pixel `width` and `height`, and the `tokens`, `contexts`, and `figures` arrays. Supply an empty array when a category has no entries.

`tokens`: Text tokens in reading order. Each token has text in `content`, numeric `confidence` expressed as a fraction from 0 to 1, and an eight-number `polygon` quadrilateral. Tokens without text do not contribute searchable terms.

`contexts`: Text regions used to group and highlight related tokens. Each has an eight-number `polygon`; `content` and `role` describe the region. Tokens belong to a region when their center lies inside its polygon.

`figures`: Non-text regions. Each has an eight-number `polygon` quadrilateral.

Optional page fields `class`, `segments`, and `indexes` are exposed through page information. An index contains string fields `label`, `value`, `source`, and `ambiguous`; index highlighting uses `source` and `value` for text matching.

Search results use the public `PageToken` shape: `token` contains the original text and `confidence` is a percentage string such as `"98%"`. These result fields differ from the input fields `content` and numeric `confidence`.

## Coordinates

Coordinates are expressed in source-page pixels. Aurora Lens maps them into the current rendered viewport, so metadata should use the same page dimensions returned by document decoding.

## Search and index highlighting

Search and index highlighting use one Fuse.js matcher for case-insensitive exact and fuzzy text matching at threshold `0.3`. Exact matches retain their better scores without excluding fuzzy matches. Punctuation is handled consistently in queries and stored text, so quoted words, initials, contractions, and compound tokens can match while returned tokens retain their original text and polygons.

Periods and commas are ignored when matching queries, tokens, index sources and values, and context text. For example, `WELLS FARGO BANK NA` matches `Wells Fargo Bank, N.A.`. Whitespace and slashes continue to separate terms, so `substitute/successor` remains searchable as separate words.

`AND` and `OR` are case-insensitive query operators, including when they occur in `source` or `context` text. `AND` requires all terms; `OR` accepts alternatives. For example, `seller or buyer` can match regions containing either `seller` or `buyer`.

### Text search

`lens.search(text, options)` searches the active page and returns `{ tokens, contexts, figures }`, or `null` when the page or its metadata is unavailable. Search returns no figure matches.

Search returns all complete exact and fuzzy occurrences. For ordinary multi-term queries and explicit `AND`, matching terms must appear in query order within one context region. Intervening words are allowed and are not highlighted. Repeated terms require separate occurrences in that order. Single-term searches and `OR` alternatives can match across the active page. An empty `contexts` array therefore still permits single-term and `OR` searches, but not ordinary multi-term ordered searches.

`options.context` selects matching context regions and restricts returned tokens to them. If that context text has no match, the text query retains its page-wide search results. An empty text query can select matching context regions alone.

### Index highlighting

`lens.highlightIndex(page, index, options)` uses this flow:

1. Find complete `index.value` matches within page context regions, allowing the value terms in any order and requiring distinct normalized token positions for repeated terms. `OR` accepts one alternative. Each candidate contains one value occurrence.
2. Rank complete value candidates ahead of source-only regions, then by the number of matching source terms, then by the lowest combined Fuse score. Equal scores retain the first occurrence in metadata order. Output only the winning occurrence.
3. Highlight the winning context region only if it also matches the complete `index.source` in query order. If no value candidate exists, retain the single best complete source region. Source-only matches do not highlight value tokens.
4. If neither a complete value region nor a complete source region matches, retain the existing page-wide value search. Highlight one value occurrence without context highlights; this also works when `contexts` is empty.

Source words receive token highlights only when they also match the selected value. A stored token that contributes several matching terms is returned and highlighted once.

The method returns `true` when source regions or value tokens are selected, otherwise `false`. The requested page must already be active; the API does not navigate. Callers can use the boolean result to show their own no-match message.

Both APIs replace the previous selection by default. Pass `additive: true` to retain earlier highlights. Selection exports group tokens by context and uppercase the exported text.

## Lifecycle

Metadata is held on the `AuroraLens` instance, not on the `File` object. Calling `decodeDoc()` changes the displayed raster page but does not clear previously loaded metadata. This allows hosts to load metadata before or after decoding, but it also means hosts must explicitly clear the lens when changing to a document without matching metadata.

Use one of these flows:

```ts
lens.loadMetadata(metadataForFile);
await lens.decodeDoc(file, { page: 26, viewMode: "page" });
```

```ts
lens.clear();
await lens.decodeDoc(fileWithoutMetadata, { page: 1, viewMode: "page" });
```
