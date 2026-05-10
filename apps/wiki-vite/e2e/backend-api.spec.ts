import { expect, test } from "@playwright/test";

const hasAiGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
const rawPiiPattern = /Diana Laster|88855655|jason\.laster\.11@gmail\.com/i;

test.describe("Vite backend API", () => {
  test("serves public session identity with public cache headers", async ({ request }) => {
    const response = await request.get("/api/wiki/session");
    expect(response.ok()).toBe(true);
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");
    expect(response.headers()["cache-control"]).toContain("public");
    expect(response.headers()["vary"]).toContain("Host");

    const body = await response.json();
    expect(body.siteSlug).toBe("diana");
    expect(body.scope).toBe("public");
    expect(body.authenticated).toBe(false);
    expect(body.cacheKey).toContain("public");
  });

  test("resolves sites from Host and ignores injected site headers", async ({ request }) => {
    const response = await request.get("/api/wiki/session", {
      headers: {
        Host: "diana.localhost",
        "x-site-slug": "not-diana",
      },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.siteSlug).toBe("diana");
    expect(body.cacheKey).toContain("diana:public");
  });

  test("fails closed for unknown hosts", async ({ request }) => {
    const response = await request.get("/api/wiki/session", {
      headers: { Host: "unknown-vite-site.invalid" },
    });
    expect([403, 404]).toContain(response.status());
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
    expect(JSON.stringify(body.results)).not.toMatch(rawPiiPattern);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        slug: expect.any(String),
        title: expect.any(String),
        excerpt: expect.any(String),
      }),
    );
  });

  test("validates backend AI search route without model credentials", async ({ request }) => {
    const method = await request.get("/api/ai-search");
    expect(method.status()).toBe(405);
    expect(method.headers()["allow"]).toBe("POST");

    const empty = await request.post("/api/ai-search", {
      data: { query: "" },
    });
    expect(empty.ok(), await empty.text()).toBe(true);
    expect(await empty.json()).toEqual({ results: [] });
  });

  test("serves live AI search rankings when credentials are configured", async ({ request }) => {
    test.skip(!hasAiGateway || !hasOpenAi, "AI search live smoke requires AI_GATEWAY_API_KEY and OPENAI_API_KEY");

    const response = await request.post("/api/ai-search", {
      data: {
        query: "diagnosis",
        slugs: ["wiki/diagnostics/diagnosis", "wiki/logistics/insurance"],
      },
      timeout: 60_000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.headers()["x-wiki-cache-scope"]).toBe("public");

    const body = await response.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        slug: expect.any(String),
        title: expect.any(String),
        relevance: expect.any(Number),
        summary: expect.any(String),
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

  test("serves scoped markdown downloads from the Vite API route", async ({ request }) => {
    const pageCopy = await request.get(
      "/api/page-copy?slug=wiki/logistics/insurance&scope=public",
    );
    expect(pageCopy.ok(), await pageCopy.text()).toBe(true);
    expect(pageCopy.headers()["content-type"]).toContain("text/markdown");
    expect(pageCopy.headers()["content-disposition"]).toContain("insurance.md");
    expect(pageCopy.headers()["x-wiki-cache-scope"]).toBe("public");
    const pageCopyText = await pageCopy.text();
    expect(pageCopyText).toContain("Insurance");
    expect(pageCopyText).not.toMatch(rawPiiPattern);

    const full = await request.get("/api/download?type=full&scope=public&limit=3", {
      timeout: 60_000,
    });
    expect(full.ok(), await full.text()).toBe(true);
    expect(full.headers()["content-type"]).toContain("text/markdown");
    expect(full.headers()["content-disposition"]).toContain("diana-wiki.md");
    expect(full.headers()["x-wiki-cache-scope"]).toBe("public");
    const fullText = await full.text();
    expect(fullText).toContain("<!--");
    expect(fullText).not.toMatch(rawPiiPattern);
  });

  test("serves the standalone login API", async ({ request }) => {
    const invalid = await request.post("/api/login", {
      data: { password: "wrong-password" },
    });
    expect(invalid.status()).toBe(401);
    expect(await invalid.json()).toEqual({ error: "Invalid password" });

    const valid = await request.post("/api/login", {
      data: { password: "diana" },
    });
    expect(valid.ok(), await valid.text()).toBe(true);
    expect(await valid.json()).toEqual({ ok: true });
    expect(valid.headers()["set-cookie"]).toContain("authed=true");
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
    expect(JSON.stringify(searchResults)).not.toMatch(rawPiiPattern);

    const page = await request.post("/api/tools", {
      data: {
        tool: "read_page",
        args: { slug: searchResults[0].slug },
      },
    });
    expect(page.ok(), await page.text()).toBe(true);
    const pageResult = await page.json();
    expect(JSON.stringify(pageResult)).not.toMatch(rawPiiPattern);
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

  test("validates full chat API route ownership and live streaming", async ({ request }) => {
    const method = await request.get("/api/chat");
    expect(method.status()).toBe(405);
    expect(method.headers()["allow"]).toBe("POST");

    const invalid = await request.post("/api/chat", {
      data: { messages: [] },
    });
    expect(invalid.status()).toBe(400);
    expect(await invalid.text()).toContain("messages must not be empty");

    test.skip(!hasAiGateway, "Chat live smoke requires AI_GATEWAY_API_KEY");

    const live = await request.post("/api/chat", {
      data: {
        messages: [
          {
            id: "msg-test",
            role: "user",
            parts: [{ type: "text", text: "Reply with exactly: pong" }],
          },
        ],
      },
      timeout: 60_000,
    });
    const liveText = await live.text();
    expect(live.ok(), liveText).toBe(true);
    expect(live.headers()["content-type"]).toContain("text/event-stream");
    expect(liveText.toLowerCase()).toContain("pong");
  });

  test("validates unknown chat tools", async ({ request }) => {
    const response = await request.post("/api/tools", {
      data: { tool: "nope", args: {} },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Unknown tool");
  });
});
