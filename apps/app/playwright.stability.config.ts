import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Synthetic fixtures on the built application: no production backend or secrets.
const port = process.env.PLAYWRIGHT_PORT || "61046";
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  ...base,
  testMatch: ["**/additive-paint.spec.ts", "**/visual-stability.spec.ts", "**/visual-observer.spec.ts", "**/visual-runtime.spec.ts"],
  globalSetup: undefined,
  outputDir: ".playwright/stability-results",
  retries: 0,
  use: { ...base.use, baseURL, storageState: undefined },
  webServer: {
    command: `bunx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
