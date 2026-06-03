import { defineConfig, devices } from "@playwright/test";
import { loadPlaywrightEnv } from "./playwright.env";
import { previewAuthStatePath } from "./playwright.global-setup";

loadPlaywrightEnv();

const port = process.env.PLAYWRIGHT_PORT || "61001";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders = previewBypassSecret
  ? {
      "x-vercel-protection-bypass": previewBypassSecret,
      "x-vercel-set-bypass-cookie": "true",
      "x-diana-test-auth": previewBypassSecret,
    }
  : undefined;
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      // Pin comments off so the mocked suite renders the deterministic outline
      // rail (comments.spec skips). Comments/Liveblocks are exercised by a live
      // run, not mocks.
      command: `PORT=${port} WIKI_VITE_FORCE_COMMENTS_OFF=1 bun dev`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    };
const previewAuthState = process.env.PLAYWRIGHT_BASE_URL && process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD
  ? previewAuthStatePath
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: previewAuthState ? "./playwright.global-setup.ts" : undefined,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  webServer,
  use: {
    baseURL,
    extraHTTPHeaders,
    storageState: previewAuthState,
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
