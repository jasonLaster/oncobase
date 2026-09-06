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

test("content APIs require the gate cookie without blocking public auth and preview APIs", async ({
  baseURL,
}) => {
  const anonymous = await playwrightRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });

  try {
    for (const pathname of [
      "/api/wiki/manifest",
      "/api/wiki/pages?slugs=wiki/logistics/insurance",
      "/api/search?q=diagnosis",
      "/api/download?type=markdown",
      "/api/file?path=sources/example.pdf",
    ]) {
      const response = await anonymous.get(pathname);
      expect(response.status(), pathname).toBe(401);
      expect(response.headers()["cache-control"], pathname).toBe(
        "private, no-store",
      );
      expect(response.headers().vary, pathname).toContain("Cookie");
      expect(response.headers().vary, pathname).toContain("Host");
      expect(await response.json(), pathname).toEqual({
        error: "Password gate authentication required",
      });
    }

    expect((await anonymous.get("/api/auth/session")).status()).toBe(200);
    expect((await anonymous.get("/api/wiki/session")).status()).toBe(200);
    expect(
      (
        await anonymous.get(
          "/api/share-preview?path=%2Fwiki%2Flogistics%2Finsurance",
        )
      ).status(),
    ).toBe(200);
  } finally {
    await anonymous.dispose();
  }

  const smokeCookie = process.env.WIKI_VITE_SMOKE_COOKIE;
  test.skip(!smokeCookie, "An authenticated password-gate cookie is required.");
  const authenticated = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Cookie: smokeCookie! },
  });

  try {
    expect((await authenticated.get("/api/wiki/manifest")).status()).toBe(200);
    expect(
      (await authenticated.get("/api/search?q=diagnosis&limit=1")).status(),
    ).toBe(200);
  } finally {
    await authenticated.dispose();
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
