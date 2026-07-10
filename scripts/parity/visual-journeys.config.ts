import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PARITY_ORIGIN ||
  process.env.PARITY_VITE_ORIGIN ||
  process.env.PLAYWRIGHT_BASE_URL ||
  "https://wiki-vite-zeta.vercel.app";
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders = previewBypassSecret
  ? {
      "x-vercel-protection-bypass": previewBypassSecret,
      "x-vercel-set-bypass-cookie": "true",
      "x-diana-test-auth": previewBypassSecret,
    }
  : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: /visual-journeys\.spec\.ts/,
  // Playwright clears its outputDir at run start. Scope it away from the
  // capture dirs (test-results/parity-journeys/<label>) so running the two
  // origin captures concurrently doesn't wipe the other run's screenshots.
  outputDir: "test-results/visual-journeys-artifacts",
  timeout: Number(process.env.PARITY_JOURNEY_TIMEOUT_MS ?? 1_800_000),
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    extraHTTPHeaders,
    screenshot: "only-on-failure",
    testIdAttribute: "data-test-id",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "visual-journeys",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
