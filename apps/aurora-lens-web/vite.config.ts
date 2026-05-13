import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "node:module": fileURLToPath(new URL("./src/aurora/nodeModuleStub.ts", import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: ["../.."],
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
