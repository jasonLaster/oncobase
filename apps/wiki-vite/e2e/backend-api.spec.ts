import { expect, test } from "@playwright/test";

test.describe("Vite backend API", () => {
  test("serves public session identity with public cache headers", async ({ request }) => {
    const response = await request.get("/api/wiki/session");
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");
    expect(response.headers()["cache-control"]).toContain("public");

    const body = await response.json();
    expect(body.scope).toBe("public");
    expect(body.authenticated).toBe(false);
    expect(body.cacheKey).toContain("public");
  });

  test("serves public manifest without sensitive pages", async ({ request }) => {
    const response = await request.get("/api/wiki/manifest");
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");

    const body = await response.json();
    expect(body.siteSlug).toBe("diana");
    expect(body.pages.length).toBeGreaterThan(0);
    expect(body.pages.some((page: { sensitive?: boolean }) => page.sensitive)).toBe(false);
  });

  test("serves backend text search from the Vite API route", async ({ request }) => {
    const response = await request.get("/api/search?q=diagnosis&limit=5");
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");

    const body = await response.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        slug: expect.any(String),
        title: expect.any(String),
        excerpt: expect.any(String),
      }),
    );
  });

  test("validates backend file error cases", async ({ request }) => {
    const missingPath = await request.get("/api/file");
    expect(missingPath.status()).toBe(400);
    expect(await missingPath.text()).toContain("Missing path");

    const unsupported = await request.get("/api/file?path=sources/example.exe");
    expect(unsupported.status()).toBe(400);
    expect(await unsupported.text()).toContain("not supported");
  });
});
