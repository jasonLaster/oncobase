import { defineConfig } from "@playwright/test";

const isLocal = process.env.TEST_ENV !== "prod";
const baseURL = isLocal
  ? "http://localhost:3000"
  : process.env.PROD_URL || "https://diana-tnbc.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: isLocal ? 0 : 1,
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "tests",
      dependencies: ["setup"],
      use: {
        storageState: "e2e/.auth/state.json",
      },
    },
  ],
  use: {
    baseURL,
    screenshot: "only-on-failure",
  },
  ...(isLocal
    ? {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
        },
      }
    : {}),
});
