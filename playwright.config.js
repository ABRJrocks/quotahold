import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4196",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm run build:site && node scripts/serve.js",
    url: "http://127.0.0.1:4196",
    reuseExistingServer: false,
  },
});
