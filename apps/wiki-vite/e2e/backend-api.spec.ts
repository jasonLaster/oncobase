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

  test("serves chat tool calls from the Vite API route", async ({ request }) => {
    const search = await request.post("/api/tools", {
      data: { tool: "search_wiki", args: { query: "diagnosis" } },
    });
    expect(search.ok(), await search.text()).toBe(true);
    expect(search.headers()["x-wiki-cache-scope"]).toBe("session");
    const searchResults = await search.json();
    expect(Array.isArray(searchResults)).toBe(true);
    expect(searchResults.length).toBeGreaterThan(0);

    const page = await request.post("/api/tools", {
      data: {
        tool: "read_page",
        args: { slug: searchResults[0].slug },
      },
    });
    expect(page.ok(), await page.text()).toBe(true);
    const pageResult = await page.json();
    expect(pageResult).toEqual(
      expect.objectContaining({
        slug: searchResults[0].slug,
        title: expect.any(String),
        content: expect.any(String),
        linked_pages: expect.any(Array),
      }),
    );

    const tags = await request.post("/api/tools", {
      data: { tool: "list_tags", args: {} },
    });
    expect(tags.ok(), await tags.text()).toBe(true);
    const tagList = await tags.json();
    expect(Array.isArray(tagList)).toBe(true);
    expect(tagList.length).toBeGreaterThan(0);

    const taggedPages = await request.post("/api/tools", {
      data: { tool: "get_pages_by_tag", args: { tag: tagList[0] } },
    });
    expect(taggedPages.ok(), await taggedPages.text()).toBe(true);
    expect(Array.isArray(await taggedPages.json())).toBe(true);
  });

  test("validates unknown chat tools", async ({ request }) => {
    const response = await request.post("/api/tools", {
      data: { tool: "nope", args: {} },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Unknown tool");
  });
});
