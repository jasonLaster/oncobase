import { defineConfig, devices } from "@playwright/test";
import { loadPlaywrightEnv } from "./playwright.env";

loadPlaywrightEnv();

const port = process.env.PLAYWRIGHT_PORT || "61001";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  webServer: {
    command: `PORT=${port} bun dev`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    testIdAttribute: "data-test-id",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
