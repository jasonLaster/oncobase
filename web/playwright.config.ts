import { defineConfig } from "@playwright/test";

const isLocal = process.env.TEST_ENV !== "prod";
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
const extraHTTPHeaders = previewBypassSecret
  ? {
      "x-vercel-protection-bypass": previewBypassSecret,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;
const requestedProdWorkers = Number.parseInt(
  process.env.PLAYWRIGHT_WORKERS ?? "10",
  10
);
const prodWorkers = Number.isFinite(requestedProdWorkers)
  ? Math.min(Math.max(requestedProdWorkers, 8), 10)
  : 10;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: !isLocal,
  retries: isLocal ? 0 : 1,
  workers: isLocal ? undefined : prodWorkers,
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
