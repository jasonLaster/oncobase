import { defineConfig, devices } from "@playwright/test";
import { loadPlaywrightEnv } from "./playwright.env";
import { previewAuthStatePath } from "./playwright.global-setup";

loadPlaywrightEnv();

const port = process.env.PLAYWRIGHT_PORT || "61001";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const localGatePasswordHash =
  "sha256:1b2fc9341a16ae4e30082965d537ae47c21a0f27fd43eab78330ed81751ae6db";
const localGateSessionSecret = "wiki-vite-playwright-gate-secret";
const localLiveblocksPublicKey =
  "pk_dev_HXZfdhC5pUVp1uUoX4mp31GEwMiYRKXXF5uoiZugexxsNV65JmHUqcRN__UFGQ05";
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
      command: `PORT=${port} bun dev`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        DIANA_WIKI_PASSWORD_HASH:
          process.env.DIANA_WIKI_PASSWORD_HASH || localGatePasswordHash,
        WIKI_GATE_SESSION_SECRET:
          process.env.WIKI_GATE_SESSION_SECRET || localGateSessionSecret,
        VITE_LIVEBLOCKS_PUBLIC_KEY:
          process.env.VITE_LIVEBLOCKS_PUBLIC_KEY || localLiveblocksPublicKey,
      },
    };
const previewAuthState = process.env.PLAYWRIGHT_BASE_URL && process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD
  ? previewAuthStatePath
  : undefined;
const browser = process.env.PLAYWRIGHT_BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(browser)) {
  throw new Error(`Unsupported PLAYWRIGHT_BROWSER: ${browser}`);
}

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
    permissions: browser === "chromium" ? ["clipboard-read", "clipboard-write"] : [],
    // This is a public repository. Live screenshots and traces can contain
    // clinical content or signed sessions, so retain them only on local runs.
    screenshot: process.env.CI ? "off" : "only-on-failure",
    testIdAttribute: "data-test-id",
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: browser,
      use: { ...devices[browser === "firefox" ? "Desktop Firefox" : browser === "webkit" ? "Desktop Safari" : "Desktop Chrome"] },
    },
  ],
});
