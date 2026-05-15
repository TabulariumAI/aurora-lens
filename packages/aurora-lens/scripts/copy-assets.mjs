import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const assets = [
  ["src/core/decoder/vendor/auroraTiff.js", "dist/core/decoder/vendor/auroraTiff.js"],
  ["src/core/decoder/vendor/aurora_tiff.wasm", "dist/core/decoder/vendor/aurora_tiff.wasm"],
];

for (const [source, target] of assets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}
