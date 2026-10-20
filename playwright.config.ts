import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: {
    channel: "msedge",
    baseURL: "http://127.0.0.1:5176",
    viewport: { width: 1280, height: 1000 },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "edge" },
    { name: "edge narrow", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort",
    url: "http://127.0.0.1:5176/tests/fixtures/deed.json",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
