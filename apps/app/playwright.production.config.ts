import { defineConfig, devices } from "@playwright/test";

if (process.env.CI || process.env.PRODUCTION_READER_TESTS !== "1") {
  throw new Error("Live reader tests are local-only. Set PRODUCTION_READER_TESTS=1.");
}
if (!process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD) throw new Error("Set the site gate password.");

export default defineConfig({
  testDir: "./production-e2e",
  outputDir: "./.playwright/production-reader/results",
  reporter: [["line"], ["json", { outputFile: "./.playwright/production-reader/results.json" }]],
  timeout: 120_000,
  expect: { timeout: 60_000 },
  workers: 2,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://diana-tnbc.com",
    testIdAttribute: "data-test-id",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: (["chromium", "firefox", "webkit"] as const).flatMap(browserName =>
    [false, true].map(mobile => ({
      name: `${browserName}-${mobile ? "phone" : "desktop"}`,
      use: {
        ...devices[browserName === "chromium" ? "Desktop Chrome" : browserName === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      },
    })),
  ),
});
