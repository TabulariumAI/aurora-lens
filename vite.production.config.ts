import { defineConfig } from "vite";

export default defineConfig({
  root: "tests/production",
  publicDir: false,
  build: { outDir: ".build", emptyOutDir: true, assetsInlineLimit: 0 },
  worker: { format: "es" },
});
