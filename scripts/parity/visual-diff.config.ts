import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PARITY_VITE_ORIGIN || "https://wiki-vite-zeta.vercel.app";

export default defineConfig({
  testDir: ".",
  testMatch: /visual-diff\.spec\.ts/,
  timeout: 120_000,
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
