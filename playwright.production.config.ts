import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/production",
  outputDir: "production-test-results",
  use: { channel: "msedge", baseURL: "http://127.0.0.1:5177" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --config vite.production.config.ts --host 127.0.0.1 --port 5177 --strictPort",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: false,
  },
});
