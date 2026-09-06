import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// These traces contain live content and signed sessions. Never publish them
// through this public repository's CI artifact/log pipeline.
if (process.env.CI) throw new Error("Live paired parity traces are local-only.");
if (!process.env.PARITY_NEXT_URL || !process.env.PARITY_VITE_URL || !process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD) {
  throw new Error("Set explicit PARITY_NEXT_URL, PARITY_VITE_URL and WIKI_VITE_PREVIEW_LOGIN_PASSWORD.");
}
// Real backends are intentional. Writes must use owned records with verified
// teardown; browser interception is not a security or containment boundary.
if (process.env.PARITY_REAL_BACKENDS !== "1") {
  throw new Error("Set PARITY_REAL_BACKENDS=1 to acknowledge real backend calls and test-owned writes with cleanup.");
}
if (!process.env.PARITY_CONVEX_URL) throw new Error("Set PARITY_CONVEX_URL to the shared real backend for verified guest cleanup.");
const browsers = (process.env.PARITY_BROWSERS || "chromium,webkit").split(",");
if (browsers.some((browser) => !["chromium", "webkit"].includes(browser))) {
  throw new Error("PARITY_BROWSERS supports chromium and webkit only.");
}
const output = path.resolve(import.meta.dirname, process.env.PARITY_OUTPUT_DIR || "../../.playwright/shared-parity");

export default defineConfig({
  testDir: "./parity-e2e",
  outputDir: path.join(output, "results"),
  reporter: [
    ["line"],
    ["json", { outputFile: path.join(output, "results.json") }],
    ["html", { outputFolder: path.join(output, "report"), open: "never" }],
  ],
  workers: 1,
  maxFailures: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    testIdAttribute: "data-test-id",
    actionTimeout: 20_000,
    trace: { mode: "on", screenshots: true, snapshots: true, sources: true },
    screenshot: "on",
  },
  projects: browsers.flatMap((browser) => ["next", "vite"].map((host) => ({
    name: `${host}-${browser}`,
    use: {
      ...devices[browser === "webkit" ? "Desktop Safari" : "Desktop Chrome"],
      viewport: { width: 1440, height: 1000 },
      baseURL: host === "next"
        ? process.env.PARITY_NEXT_URL
        : process.env.PARITY_VITE_URL,
    },
  }))),
});
