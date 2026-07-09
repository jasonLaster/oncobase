import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PARITY_VITE_ORIGIN || "https://wiki-vite-zeta.vercel.app";

export default defineConfig({
  testDir: ".",
  testMatch: /visual-diff\.spec\.ts/,
  // Full-corpus captures walk thousands of pages; scale the ceiling to the
  // sample size via env, defaulting high enough for bounded samples.
  timeout: Number(process.env.PARITY_VISUAL_TIMEOUT_MS ?? 1_800_000),
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "visual-diff",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
