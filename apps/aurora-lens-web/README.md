# Tabularium AI Lens Web

Tabularium AI Lens Web is a React and Vite demo application for viewing documents with the `@tabularium/aurora-lens` component. It supports local document loading, page navigation, thumbnails, metadata overlays, search, selection, and copy workflows.

The reusable viewer component and document decoder live in `packages/aurora-lens`. This app is only the demo shell around the component.

## Repository Layout

```text
src/app               Application state and load flows
src/components        Viewer shell, loader, details panel, toolbar, footer
src/lens              Host-side lens types and theme
public/icons          Browser and install icons
public/brand          In-app logo assets
public/samples        Bundled demo samples
tests/browser         Playwright end-to-end tests
```

## Requirements

- Node.js 22
- npm
- The monorepo workspace install from the repository root

## Install

Run `npm install` from the repository root.

## Development

```sh
npm run dev:web
```

The dev server defaults to `127.0.0.1:5173`. You can override it:

```sh
npm run dev -- --host 127.0.0.1 --port 5174
```

## Checks

```sh
npm test
npm run test:browser
npm run build
npm audit --audit-level=moderate
```

## Public Fixtures

The bundled samples in `public/samples` are demo documents. Confirm the samples are approved for public distribution before publishing this repository.

Do not modify sample fixture contents as part of repository publishing hygiene. Treat sample updates as a separate content approval change.

## Metadata Lifecycle

When loading a user-selected document without metadata, the app clears the current lens before decoding the new file. This prevents metadata from a previous sample from being reused by page index.

Sample loading uses the intended metadata flow:

```ts
await lens.loadMetadata(metadata);
await lens.decodeDoc(file, 0);
```

User file loading uses:

```ts
lens.clear();
await lens.decodeDoc(file, 0);
```

## Release Notes

Before making this repository public, confirm distribution rights for bundled samples and decoder runtime files.

## License

See [LICENSE](LICENSE) and [NOTICE](NOTICE).
