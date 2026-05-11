# Aurora Lens

Aurora Lens is a framework-agnostic document viewer from Tabularium AI. It renders decoded raster pages, overlays Tabularium AI metadata, supports selection, copy, search, zoom, and thumbnails, and keeps decoding behind an application-owned adapter.

Aurora, the proprietary Tabularium AI runtime, is not included in this package.

## Install

```sh
npm install @tabularium/aurora-lens
```

## Usage

```tsx
import { useMemo, useRef } from "react";
import { ReactViewer } from "@tabularium/aurora-lens/react";
import type { AuroraLens, ViewerDecoder } from "@tabularium/aurora-lens";

export function Viewer({ decoder }: { decoder: ViewerDecoder }) {
  const lensRef = useRef<AuroraLens | null>(null);
  const stableDecoder = useMemo(() => decoder, [decoder]);

  return (
    <ReactViewer
      ref={lensRef}
      decoder={stableDecoder}
      onError={(error) => console.error(error)}
    />
  );
}
```

## Decoder Contract

Applications own decoding. Provide an `ViewerDecoder` implementation that returns RGBA pixels for a requested page.
Because the decoder is host-owned, release decoder resources from the host application lifecycle.

```ts
import type { ViewerDecoder, RasterPage } from "@tabularium/aurora-lens";

export class AppDecoder implements ViewerDecoder {
  async decode(file: File, pageIndex: number): Promise<RasterPage> {
    return decodePageInYourApplication(file, pageIndex);
  }

  async thumbnail(file: File, pageIndex: number, maxSize: number): Promise<RasterPage> {
    return decodeThumbnailInYourApplication(file, pageIndex, maxSize);
  }

  close() {
    releaseApplicationDecoderResources();
  }
}
```

## Metadata

Aurora Lens can render Tabularium AI metadata when the host application calls `loadMetadata(metadata)` before or after decoding a page. Metadata is document-scoped and remains loaded on the lens instance until the host calls `clear()` or replaces it with another `loadMetadata()` call.

When switching to a document that does not have matching metadata, call `clear()` before `decodeTiff()` so metadata from the previous document cannot be reused by page index.

```ts
await lensRef.current?.loadMetadata(metadata);
await lensRef.current?.decodeTiff(fileWithMetadata, 0);

lensRef.current?.clear();
await lensRef.current?.decodeTiff(fileWithoutMetadata, 0);
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

This package does not include the proprietary Aurora runtime. Host applications provide decoding through the `ViewerDecoder` contract.

Generated build output, Playwright reports, test results, and local environment files are ignored by Git. Source, tests, documentation, and package metadata are the public repository surface.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
