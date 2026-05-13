import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const assets = [
  ["src/core/documentDecoder/vendor/auroraTiff.js", "dist/core/documentDecoder/vendor/auroraTiff.js"],
  ["src/core/documentDecoder/vendor/aurora_tiff.wasm", "dist/core/documentDecoder/vendor/aurora_tiff.wasm"],
];

for (const [source, target] of assets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}
