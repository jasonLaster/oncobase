import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", timeout: 60_000, expect: { timeout: 15_000 }, workers: 1,
  use: { baseURL: process.env.ONCOGUIDE_BASE_URL || "http://127.0.0.1:62009", ...devices["Desktop Chrome"], trace: "off", screenshot: "off", testIdAttribute: "data-test-id" },
  webServer: process.env.ONCOGUIDE_BASE_URL ? undefined : { command: "bun scripts/serve-export.ts", url: "http://127.0.0.1:62009", reuseExistingServer: !process.env.CI },
});
