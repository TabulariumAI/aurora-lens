# Aurora Lens

Aurora Lens is a framework-agnostic document viewer from Tabularium AI. It decodes supported documents, renders normalized raster pages, overlays Tabularium AI metadata, supports selection, copy, search, zoom, and thumbnails, and stores decoded pages for fast navigation.

Aurora, the proprietary Tabularium AI runtime, is not included in this package.

## Install

```sh
npm install @tabularium/aurora-lens
```

## Usage

```tsx
import { useRef } from "react";
import { ReactViewer } from "@tabularium/aurora-lens/react";
import type { AuroraLens } from "@tabularium/aurora-lens";

export function Viewer() {
  const lensRef = useRef<AuroraLens | null>(null);

  return (
    <ReactViewer
      ref={lensRef}
      allowEdit={true}
      onError={(error) => console.error(error)}
    />
  );
}
```

## Document Decoding

The package owns document detection and decoding through `decodeDoc(file, pageIndex)`. Supported input formats are TIFF/TIF, PDF, PNG, and JPG/JPEG.

## Viewer Config

The package owns viewer configuration through `readViewerConfig()` and `saveViewerConfig(config)`. The config includes accepted page formats, tolerance, view raster settings, and export raster settings. Current viewing uses the `view` raster settings; export settings are stored separately for export workflows.

## Metadata

Aurora Lens can render Tabularium AI metadata when the host application calls `loadMetadata(metadata)` before or after decoding a page. Metadata is document-scoped and remains loaded on the lens instance until the host calls `clear()` or replaces it with another `loadMetadata()` call.

When switching to a document that does not have matching metadata, call `clear()` before `decodeDoc()` so metadata from the previous document cannot be reused by page index.

```ts
await lensRef.current?.loadMetadata(metadata);
await lensRef.current?.decodeDoc(fileWithMetadata, 0);

lensRef.current?.clear();
await lensRef.current?.decodeDoc(fileWithoutMetadata, 0);
```

See [docs/metadata-schema.md](docs/metadata-schema.md).

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
