import { defineConfig } from "@playwright/test";
import { localPlaywrightServerEnv } from "./e2e/test-environment";

const isLocal = process.env.TEST_ENV !== "prod";
const isEndform = Boolean(process.env.ENDFORM_API_KEY);
const localPort = process.env.PLAYWRIGHT_PORT || "3000";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  (isLocal
    ? `http://localhost:${localPort}`
    : process.env.PROD_URL || "https://diana-tnbc.vercel.app");
const localGatePasswordHash =
  "sha256:1b2fc9341a16ae4e30082965d537ae47c21a0f27fd43eab78330ed81751ae6db";
const localGateSessionSecret = "web-playwright-gate-secret";
const webServer = isLocal
  ? {
      command: `PORT=${localPort} bun dev:app`,
      env: {
        ...localPlaywrightServerEnv(),
        DIANA_WIKI_PASSWORD_HASH:
          process.env.DIANA_WIKI_PASSWORD_HASH || localGatePasswordHash,
        WIKI_GATE_SESSION_SECRET:
          process.env.WIKI_GATE_SESSION_SECRET || localGateSessionSecret,
      },
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
const isProductionSmoke = process.env.PLAYWRIGHT_SUITE === "production-smoke";
const isCrossBrowserSmoke = process.env.PLAYWRIGHT_SUITE === "cross-browser-smoke";
const failOnSkip = process.env.PLAYWRIGHT_FAIL_ON_SKIP === "1";
const requestedBrowser = process.env.PLAYWRIGHT_BROWSER;
const browserName: "chromium" | "firefox" | "webkit" =
  requestedBrowser === "firefox" || requestedBrowser === "webkit"
    ? requestedBrowser
    : "chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: !isLocal && !isEndform,
  retries: isLocal ? 0 : 1,
  workers: isLocal ? 1 : prodWorkers,
  reporter: failOnSkip
    ? [
        ["list"],
        ["html", { open: "never" }],
        ["./e2e/fail-on-skip-reporter.ts"],
      ]
    : undefined,
  webServer,
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "tests",
      dependencies: ["setup"],
      grep: isCrossBrowserSmoke
        ? /@cross-browser/
        : isProductionSmoke
          ? /@smoke/
          : undefined,
      use: {
        browserName,
        storageState: "e2e/.auth/state.json",
      },
    },
  ],
  use: {
    baseURL,
    extraHTTPHeaders,
    screenshot: "only-on-failure",
    testIdAttribute: "data-test-id",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
});
