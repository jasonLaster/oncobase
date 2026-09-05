import { expect, test, type Page } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

// This diagnostic suite is limited to the anonymous login and synthetic reader.
// It never emits authenticated page bodies, cookies, or arbitrary request headers.
async function withStartupDiagnostics(page: Page, check: () => Promise<void>) {
  const runtimeErrors: Array<{ name: string; message: string }> = [];
  const failedAssets: Array<{ path: string; status: number }> = [];
  page.on("pageerror", (error) => runtimeErrors.push({ name: error.name, message: error.message.slice(0, 160) }));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/assets/") && response.status() >= 400) failedAssets.push({ path, status: response.status() });
  });
  try {
    await check();
  } catch (error) {
    const capabilities = await page.evaluate(() => ({
      secureContext: isSecureContext,
      sharedWorker: typeof SharedWorker,
      sharedArrayBuffer: typeof SharedArrayBuffer,
      storageDirectory: typeof navigator.storage?.getDirectory,
      crossOriginIsolated,
    })).catch(() => null);
    console.log(JSON.stringify({ runtimeErrors, failedAssets, capabilities, loginPath: new URL(page.url()).pathname === "/login" }));
    throw error;
  }
}

test("anonymous login boots in the selected browser", async ({ page, context }) => {
  await context.clearCookies();
  await withStartupDiagnostics(page, async () => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  });
});

test("synthetic reader boots in the selected browser", async ({ page }) => {
  // Block every real page API, then layer the same fixtures used by E2E.
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await installWikiApiMocks(page);
  await withStartupDiagnostics(page, () => gotoWiki(page, "/wiki/logistics/insurance"));
});

test("blank browser contexts repeatedly open and close without app code", async ({ browser }) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await expect(page).toHaveURL("about:blank");
    } finally {
      await context.close();
    }
  }
});
