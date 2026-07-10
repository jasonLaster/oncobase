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
  // capture dirs (test-results/parity-journeys/<label>) AND per origin label,
  // so concurrent origin captures neither wipe each other's screenshots nor
  // race on each other's trace files.
  outputDir: `test-results/visual-journeys-artifacts/${
    (process.env.PARITY_ORIGIN_LABEL || "origin").replace(/[^a-z0-9._-]+/gi, "_")
  }`,
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
