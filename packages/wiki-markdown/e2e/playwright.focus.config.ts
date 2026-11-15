import { defineConfig } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const port = Number(process.env.FOCUS_FIXTURE_PORT ?? "62828");
export default defineConfig({
  testDir: ".", testMatch: /(?:image-theater-focus|handoff-focus)\.spec\.ts/, workers: 1,
  outputDir: process.env.FOCUS_OUTPUT ?? "test-results",
  timeout: 20_000, expect: { timeout: 1500 },
  reporter: [["list"], ["json", { outputFile: process.env.FOCUS_REPORT ?? "focus-results.json" }]],
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure", trace: "off" },
  projects: [
    ...["button", "delegated"].flatMap(mode => ["light", "dark"].flatMap(theme => [1280, 390].map(width => ({
    name: `${mode}-${theme}-${width}`,
    testMatch: "image-theater-focus.spec.ts",
    metadata: { mode, theme },
    use: { viewport: { width, height: 900 }, colorScheme: theme as "light" | "dark" },
    })))),
    ...["light", "dark"].flatMap(theme => [1280, 390].map(width => ({
      name: `handoff-${theme}-${width}`,
      testMatch: "handoff-focus.spec.ts",
      metadata: { mode: "handoff", theme },
      use: { viewport: { width, height: 900 }, colorScheme: theme as "light" | "dark" },
    }))),
  ],
  webServer: {
    command: "bun build e2e/focus-fixture.tsx --target=browser --outdir=e2e/.fixture-dist --define 'process.env.NODE_ENV=\"development\"' && bun e2e/serve-focus-fixture.ts",
    cwd: dirname(fileURLToPath(import.meta.url)) + "/..", url: `http://127.0.0.1:${port}`, reuseExistingServer: false,
  },
});
