# Tabularium AI Lens

This monorepo contains the reusable Aurora Lens viewer package and the Tabularium AI Lens web demo.

## Projects

```text
packages/aurora-lens     Reusable viewer package
apps/aurora-lens-web     React and Vite TIFF demo app
```

## Requirements

- Node.js 22
- npm

## Install

```sh
npm install
```

## Development

```sh
npm run dev:web
```

## Checks

```sh
npm test
npm run build
npm run web:test:browser
npm audit --audit-level=moderate
```

## Publishing

The web app is private and is intended to be published as a repository or deployed app, not as an npm package.

The reusable package can be packed or published from its workspace:

```sh
npm pack --dry-run --workspace @tabularium/aurora-lens
```

## Public Assets

The demo TIFF samples live under `apps/aurora-lens-web/public/samples`. Do not modify sample fixture contents as part of repository maintenance or publishing hygiene. Treat sample updates as a separate content approval change.

## License

See the root license plus project-level notice files:

- [LICENSE](LICENSE)
- [apps/aurora-lens-web/LICENSE](apps/aurora-lens-web/LICENSE)
