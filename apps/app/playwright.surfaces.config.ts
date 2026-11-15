import { rmSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Surface gates: visual baselines, an axe ratchet and keyboard checks over every surface in
 * surface-gates/surfaces.ts. Local stack only. Run through the stack so its env is loaded:
 *
 *   bun run local:stack
 *   bun run surfaces:test
 *
 * This deliberately lives outside e2e/, which CI also runs against deployed URLs.
 */
const port = process.env.SURFACES_PORT || "63010";
const baseURL = `http://127.0.0.1:${port}`;

// This is a public repository and CI uploads this suite's screenshots and diffs. That is safe
// only because the local stack serves the synthetic fixture vault. Refuse anything else.
if (process.env.PLAYWRIGHT_BASE_URL) {
  throw new Error("Surface gates never run against a deployed URL; unset PLAYWRIGHT_BASE_URL.");
}
const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Surface gates need the local stack env. Run through `bun run local:stack exec -- ...` (or `bun run surfaces:test`).");
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(convexUrl).hostname)) {
  throw new Error(`Surface gates run only against a local Convex backend; refusing ${convexUrl}.`);
}

if (process.env.SURFACES_RATCHET === "update") {
  rmSync(path.join(import.meta.dirname, ".playwright/surfaces/ratchet-fragments"), { recursive: true, force: true });
}

// Each invocation gets its own folder so a later run (CI runs gates, then visual) does not wipe
// the earlier run's failure artifacts.
const run = process.env.SURFACES_RUN || "local";

export default defineConfig({
  testDir: "./surface-gates",
  outputDir: `./.playwright/surfaces/${run}/results`,
  // Baselines are rendered on Linux (in the Playwright image, see surface-gates/docker/run.sh).
  // Other platforms write to their own gitignored folder so a macOS run never clobbers them.
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  globalTeardown: "./surface-gates/ratchet-teardown.ts",
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: `./.playwright/surfaces/${run}/report` }]]
    : [["line"]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", maxDiffPixelRatio: 0.002 },
  },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  webServer: {
    // The standalone server on the stack's built reader, on a port of its own. Never reuse a
    // server already on the port: it could be another checkout's stack.
    command: `PORT=${port} bun scripts/local-stack.ts serve`,
    url: `${baseURL}/robots.txt`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
  },
  use: {
    baseURL,
    testIdAttribute: "data-test-id",
    screenshot: "off",
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
