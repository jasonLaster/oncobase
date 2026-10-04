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
    // The bare domain shows the landing page; private links go to sign-in.
    const root = await anonymous.get("/", { maxRedirects: 0 });
    expect(root.status()).toBe(200);
    expect(await root.text()).toContain('name="wiki-reader-access" content="landing"');
    const deep = await anonymous.get(deepPath, { maxRedirects: 0 });
    expect(deep.status()).toBe(302);
    expect(deep.headers().location).toContain(`/sign-in?redirect=${encodeURIComponent(deepPath)}`);
    for (const response of [root, deep]) {
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
    // The default site serves anonymous reads from the public education
    // library: uncacheable, and never any care-wiki page.
    for (const pathname of ["/api/wiki/manifest", "/api/search?q=diagnosis"]) {
      const response = await anonymous.get(pathname);
      expect(response.status(), pathname).toBe(200);
      expect(response.headers()["cache-control"], pathname).toBe("private, no-store");
      expect(response.headers().vary, pathname).toContain("Cookie");
      const body = await response.json() as { pages?: Array<{ slug: string }>; results?: Array<{ slug: string }> };
      const slugs = [...(body.pages ?? []), ...(body.results ?? [])].map(page => page.slug.toLowerCase());
      expect(slugs.filter(slug => !slug.startsWith("wiki/education/")), pathname).toEqual([]);
    }

    for (const pathname of [
      "/api/wiki/pages?slugs=wiki/logistics/insurance",
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

test("anonymous browser reaches sign-in while authenticated navigation renders the wiki", async ({
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newPage();
  await anonymous.goto(deepPath, { waitUntil: "domcontentloaded" });
  await expect(anonymous).toHaveURL(/\/sign-in\?redirect=%2Fwiki%2Flogistics%2Finsurance$/);
  await expect(anonymous.getByTestId("sign-in-page")).toBeVisible();
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
