import { defineConfig } from "@playwright/test";

const isLocal = process.env.TEST_ENV !== "prod";
const isEndform = Boolean(process.env.ENDFORM_API_KEY);
const baseURL = isLocal
  ? "http://localhost:3000"
  : process.env.PROD_URL || "https://diana-tnbc.vercel.app";
const webServer = isLocal
  ? {
      command: "bun dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    }
  : undefined;
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const previewBypassHeaders = previewBypassSecret
  ? {
      "x-vercel-protection-bypass": previewBypassSecret,
      "x-diana-test-auth": previewBypassSecret,
    }
  : undefined;
const extraHTTPHeaders = previewBypassHeaders;
const requestedProdWorkers = Number.parseInt(
  process.env.PLAYWRIGHT_WORKERS ?? "4",
  10
);
const prodWorkers = Number.isFinite(requestedProdWorkers)
  ? Math.min(Math.max(requestedProdWorkers, 1), 4)
  : 4;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: !isLocal && !isEndform,
  retries: isLocal ? 0 : 1,
  workers: isLocal ? 1 : prodWorkers,
  webServer,
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "tests",
      dependencies: ["setup"],
      use: {
        storageState: "e2e/.auth/state.json",
      },
    },
  ],
  use: {
    baseURL,
    extraHTTPHeaders,
    screenshot: "only-on-failure",
  },
});
