# Contributing

## Requirements

- Node.js 22
- npm

## Local Checks

```sh
npm install
npm test
npm run build
npm run example:build
npm run example:test
npm run web:test:browser
```

## Guidelines

- Keep reusable viewer behavior in `packages/aurora-lens`.
- Keep demo application behavior in `apps/aurora-lens-web`.
- Keep decoding runtime integration outside the reusable package.
- Preserve the `AuroraLensDecoder` boundary for host-owned raster decoding.
- Add or update tests for behavior changes.
- Do not modify sample fixture contents as part of general repository maintenance.
- Do not commit generated build output, Playwright reports, test results, package tarballs, or local environment files.
