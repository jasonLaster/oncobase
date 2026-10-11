import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "**/chat.spec.ts", timeout: 60_000,
  expect: { timeout: 15_000 }, workers: 1,
  updateSnapshots: "none",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: { baseURL: "http://127.0.0.1:62012", ...devices["Desktop Chrome"], trace: "retain-on-failure", screenshot: "only-on-failure", testIdAttribute: "data-test-id" },
  // An isolated, credential-free server. Never reuse a live-model preview.
  webServer: { command: "bun scripts/serve-export.ts", url: "http://127.0.0.1:62012/__chat-e2e/health", reuseExistingServer: false,
    env: { PORT: "62012", ONCOGUIDE_CHAT_REPLAY: "1", ONCOGUIDE_CHAT_LOCAL: "0", AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "" } },
});
