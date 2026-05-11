import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: exampleRoot,
  resolve: {
    alias: {
      "@tabularium/aurora-lens/react": fileURLToPath(new URL("../../src/react/index.ts", import.meta.url)),
      "@tabularium/aurora-lens": fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    },
  },
});
