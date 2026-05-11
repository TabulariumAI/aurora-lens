import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: "./tests",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4187",
  },
  webServer: {
    command: "npm run example:build && npx vite preview --config examples/basic/vite.config.ts --host 127.0.0.1 --port 4187 --strictPort",
    cwd: packageRoot,
    reuseExistingServer: false,
    url: "http://127.0.0.1:4187",
  },
});
