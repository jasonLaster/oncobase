import { request, type FullConfig } from "@playwright/test";
import { loadPlaywrightEnv } from "./playwright.env";

loadPlaywrightEnv();

// Keep setup state outside Playwright's output directory. The runner clears
// test-results as it starts, which can otherwise delete the freshly-created
// authenticated state before the first dependent test opens a context.
export const previewAuthStatePath = "e2e/.auth/preview-auth-state.json";

export default async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL;
  const password = process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD;
  if (!baseURL || !password) return;

  const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const extraHTTPHeaders = previewBypassSecret
    ? {
        "x-vercel-protection-bypass": previewBypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      }
    : undefined;

  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders,
  });

  try {
    const response = await context.post("/api/login", {
      data: { password },
    });
    if (!response.ok()) {
      throw new Error(`Preview login failed: ${response.status()} ${await response.text()}`);
    }
    await context.storageState({ path: previewAuthStatePath });
  } finally {
    await context.dispose();
  }
}
