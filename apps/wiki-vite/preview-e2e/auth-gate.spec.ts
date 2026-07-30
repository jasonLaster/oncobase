import { expect, request as playwrightRequest, test } from "@playwright/test";

const deepPath = "/wiki/logistics/insurance";

test("anonymous root and deep links use the same uncached password gate", async ({
  baseURL,
}) => {
  const anonymous = await playwrightRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });

  try {
    for (const pathname of ["/", deepPath]) {
      const response = await anonymous.get(pathname, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toContain(
        `/login?redirect=${encodeURIComponent(pathname)}`,
      );
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(response.headers().vary).toContain("Cookie");
      expect(response.headers().vary).toContain("Host");
    }
  } finally {
    await anonymous.dispose();
  }
});

test("anonymous browser lands on login while authenticated navigation renders the wiki", async ({
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newPage();
  await anonymous.goto("/", { waitUntil: "domcontentloaded" });
  await expect(anonymous).toHaveURL(/\/login\?redirect=%2F$/);
  await expect(anonymous.getByTestId("login-page")).toBeVisible();
  await anonymous.close();

  const smokeCookie = process.env.WIKI_VITE_SMOKE_COOKIE;
  test.skip(!smokeCookie, "An authenticated password-gate cookie is required.");

  const authenticatedContext = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { Cookie: smokeCookie! },
  });
  const authenticated = await authenticatedContext.newPage();

  try {
    await authenticated.goto("/", { waitUntil: "domcontentloaded" });
    await expect(authenticated.getByTestId("wiki-sidebar")).toBeVisible();
    await authenticated.goto(deepPath, { waitUntil: "domcontentloaded" });
    await expect(authenticated.getByTestId("document-article")).toContainText(
      /insurance|authorization|coverage/i,
    );
  } finally {
    await authenticatedContext.close();
  }
});
