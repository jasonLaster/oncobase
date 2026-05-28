import { defineConfig, devices } from "@playwright/test";
import { loadPlaywrightEnv } from "./playwright.env";

loadPlaywrightEnv();

const baseURL = process.env.PLAYWRIGHT_BASE_URL;

if (!baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for the Vite preview smoke test");
}

export default defineConfig({
  testDir: "./preview-e2e",
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
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
