import { cp, copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const assets = [
  ["src/core/decoder/vendor/auroraTiff.js", "dist/core/decoder/vendor/auroraTiff.js"],
  ["src/core/decoder/vendor/aurora_tiff.wasm", "dist/core/decoder/vendor/aurora_tiff.wasm"],
  ["../../node_modules/pdfjs-dist/build/pdf.worker.mjs", "dist/core/decoder/vendor/pdf.worker.mjs"],
  ["../../node_modules/pdfjs-dist/build/pdf.worker.mjs.map", "dist/core/decoder/vendor/pdf.worker.mjs.map"],
];

for (const [source, target] of assets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

await cp("../../node_modules/pdfjs-dist/wasm", "dist/core/decoder/vendor/pdfjs-wasm", { recursive: true });
await cp("../../node_modules/pdfjs-dist/standard_fonts", "dist/core/decoder/vendor/pdfjs-standard-fonts", { recursive: true });
