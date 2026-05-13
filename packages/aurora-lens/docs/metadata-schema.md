# Tabularium AI Metadata

Aurora Lens accepts Tabularium AI metadata as a JSON object with a `pages` array. Page indexes are zero-based in the API and one-based in user-facing labels.

```json
{
  "pages": [
    {
      "tokens": [
        {
          "token": "abcd",
          "confidence": "HIGH",
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

`pages`: Required array. Each item describes metadata for one decoded page.

`tokens`: Optional array of text tokens. `token` may be `null`, `confidence` is used by the selection theme, and `polygon` is an eight-number quadrilateral.

`contexts`: Optional array of semantic text regions. `content` may be `null`, `role` is optional, and `polygon` is an eight-number quadrilateral.

`figures`: Optional array of non-text regions. `polygon` is an eight-number quadrilateral.

## Coordinates

Coordinates are expressed in source-page pixels. Aurora Lens maps them into the current rendered viewport, so metadata should use the same page dimensions returned by document decoding.

## Lifecycle

Metadata is held on the `AuroraLens` instance, not on the `File` object. Calling `decodeDoc()` changes the displayed raster page but does not clear previously loaded metadata. This allows hosts to load metadata before or after decoding, but it also means hosts must explicitly clear the lens when changing to a document without matching metadata.

Use one of these flows:

```ts
await lens.loadMetadata(metadataForFile);
await lens.decodeDoc(file, 0);
```

```ts
lens.clear();
await lens.decodeDoc(fileWithoutMetadata, 0);
```
