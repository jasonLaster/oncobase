import { defineConfig } from "@playwright/test";

const isLocal = process.env.TEST_ENV !== "prod";
const baseURL = isLocal
  ? "http://localhost:3000"
  : process.env.PROD_URL || "https://diana-tnbc.vercel.app";
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders = previewBypassSecret
  ? {
      "x-vercel-protection-bypass": previewBypassSecret,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;
const requestedProdWorkers = Number.parseInt(
  process.env.PLAYWRIGHT_WORKERS ?? "6",
  10
);
const prodWorkers = Number.isFinite(requestedProdWorkers)
  ? Math.min(Math.max(requestedProdWorkers, 5), 10)
  : 6;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: isLocal ? 0 : 1,
  workers: isLocal ? undefined : prodWorkers,
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
