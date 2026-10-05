import JSZip from "jszip";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  assertPrivate,
  createFixtureSite,
  gatedContext,
  piiDocument,
  RAW_IDENTIFIERS,
  requireLocalStack,
  signedInContext,
} from "./helpers";

// Every content API answers from the active site's public scope, and redacts
// identifiers at the API boundary: showPII is not an escape hatch. Replaces
// the PII API checks of pii-redaction / backend-api and the site-scoped
// download, tool and search invariants of multi-site-isolation.
requireLocalStack();

const CARE = { email: "care@local.test", password: "local-care-password" };
const fixtures = createFixtureSite();
const { nonce } = fixtures;
const pii = piiDocument(nonce);
const sensitive = {
  slug: `sources/contract-${nonce}/sensitive-note`,
  title: `Contract sensitive note ${nonce}`,
  content: `Sensitive body only a signed-in care-team account may read. Marker sensmark${nonce}.`,
  // The seeded care-team role reads pages tagged "sensitive".
  tags: ["sensitive", "contract-sensitive"],
  sensitive: true,
};

test.beforeAll(async () => {
  await fixtures.document(pii);
  await fixtures.document(sensitive);
});
test.afterAll(() => fixtures.dispose());

const json = async (context: APIRequestContext, path: string, init?: { data?: unknown; method?: "POST" }) => {
  const response = await context.fetch(path, init);
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return { response, body: await response.json() };
};

// The server keeps the public search corpus for up to a minute, so a page seeded
// a moment ago becomes searchable on the next refresh rather than immediately.
const waitForSearch = (context: APIRequestContext, path: string, slug: string) =>
  expect
    .poll(async () => ((await (await context.get(path)).json()) as { results: Array<{ slug: string }> }).results.map((result) => result.slug), {
      message: `search ${path} finds ${slug}`,
      timeout: 100_000,
      intervals: [2_000],
    })
    .toContain(slug);

test.setTimeout(150_000);

test("a gate-only reader gets public, redacted, uncached answers from every content API", async ({ baseURL }) => {
  const reader = await gatedContext(baseURL!);
  try {
    // Manifest: public scope, private caching, and no sensitive page or raw identifier.
    const manifest = await json(reader, "/api/wiki/manifest");
    expect(manifest.response.headers()["x-wiki-cache-scope"]).toBe("public");
    assertPrivate(manifest.response, "manifest");
    expect(manifest.response.headers()["cdn-cache-control"]).toBeUndefined();
    expect(manifest.response.headers().etag).toBeTruthy();
    expect(manifest.body.siteSlug).toBe("diana");
    expect(manifest.body.pages.length).toBeGreaterThan(0);
    expect(manifest.body.pages.some((page: { sensitive?: boolean }) => page.sensitive)).toBe(false);
    expect(manifest.body.pages.map((page: { slug: string }) => page.slug)).not.toContain(sensitive.slug);
    expect(JSON.stringify(manifest.body)).not.toMatch(RAW_IDENTIFIERS);

    // Text search: finds the redacted page by marker, never the sensitive one.
    const query = (term: string) => `/api/search?q=${encodeURIComponent(term)}&limit=5`;
    await waitForSearch(reader, query(`piimark${nonce}`), pii.slug);
    const found = await json(reader, query(`piimark${nonce}`));
    assertPrivate(found.response, "search");
    expect(found.response.headers()["x-wiki-cache-scope"]).toBe("public");
    expect(found.body.results.map((result: { slug: string }) => result.slug)).toContain(pii.slug);
    expect(JSON.stringify(found.body)).not.toMatch(RAW_IDENTIFIERS);
    const hidden = await json(reader, query(`sensmark${nonce}`));
    expect(hidden.body.results).toEqual([]);

    // Chat tools: same scope and redaction, and an unreadable page reads as absent.
    const tool = (name: string, args: unknown) => json(reader, "/api/tools", { method: "POST", data: { tool: name, args } });
    const toolSearch = await tool("search_wiki", { query: `piimark${nonce}` });
    expect(toolSearch.body.map((result: { slug: string }) => result.slug)).toContain(pii.slug);
    expect(JSON.stringify(toolSearch.body)).not.toMatch(RAW_IDENTIFIERS);
    const read = await tool("read_page", { slug: pii.slug });
    expect(read.body).toMatchObject({ slug: pii.slug, title: pii.title, linked_pages: expect.any(Array) });
    expect(read.body.content).toContain("[redacted MRN]");
    expect(JSON.stringify(read.body)).not.toMatch(RAW_IDENTIFIERS);
    const unreadable = await tool("read_page", { slug: sensitive.slug });
    expect(JSON.stringify(unreadable.body)).not.toContain(`sensmark${nonce}`);
    const tags = await tool("list_tags", {});
    expect(tags.body.length).toBeGreaterThan(0);
    expect(tags.body).not.toContain("contract-sensitive");
    expect(Array.isArray((await tool("get_pages_by_tag", { tag: tags.body[0] })).body)).toBe(true);

    // Page pages and markdown copy: redacted whether or not showPII is asked for.
    for (const query of ["", "&showPII=1"]) {
      const copy = await reader.get(`/api/page-copy?slug=${encodeURIComponent(pii.slug)}&scope=public${query}`);
      expect(copy.ok(), await copy.text()).toBeTruthy();
      expect(copy.headers()["content-type"]).toContain("text/markdown");
      expect(copy.headers()["content-disposition"]).toContain(".md");
      expect(copy.headers()["x-wiki-cache-scope"]).toBe("public");
      const text = await copy.text();
      expect(text, `copy${query}`).toContain("[redacted MRN]");
      expect(text, `copy${query}`).not.toMatch(RAW_IDENTIFIERS);
    }
    const pages = await json(reader, `/api/wiki/pages?scope=public&slugs=${encodeURIComponent(pii.slug)}&showPII=1`);
    expect(pages.body.pages[0].content).toContain("[redacted MRN]");
    expect(JSON.stringify(pages.body)).not.toMatch(RAW_IDENTIFIERS);
    const blocked = await reader.get(`/api/page-copy?slug=${encodeURIComponent(sensitive.slug)}&scope=public`);
    expect(await blocked.text()).not.toContain(`sensmark${nonce}`);
  } finally {
    await reader.dispose();
  }
});

test("a signed-in care-team session reads sensitive pages but identifiers stay redacted", async ({ baseURL }) => {
  const care = await signedInContext(baseURL!, CARE);
  try {
    await waitForSearch(care, `/api/search?scope=session&q=${encodeURIComponent(`sensmark${nonce}`)}&limit=5`, sensitive.slug);
    const read = await json(care, "/api/tools", { method: "POST", data: { tool: "read_page", args: { slug: pii.slug } } });
    expect(read.body.content).toContain("[redacted MRN]");
    expect(JSON.stringify(read.body)).not.toMatch(RAW_IDENTIFIERS);
    const copy = await care.get(`/api/page-copy?slug=${encodeURIComponent(pii.slug)}&showPII=1`);
    expect(await copy.text()).not.toMatch(RAW_IDENTIFIERS);
  } finally {
    await care.dispose();
  }
});

test("markdown and full archives hold the public site only and stay redacted under showPII", async ({ baseURL }) => {
  const reader = await gatedContext(baseURL!);
  try {
    for (const [query, filename] of [
      ["type=markdown&scope=public&showPII=1", "-markdown.zip"],
      ["type=full&scope=public&showPII=1&assetLimit=1", "-full.zip"],
    ] as const) {
      const response = await reader.get(`/api/download?${query}`, { timeout: 60_000 });
      expect(response.ok(), await response.text()).toBeTruthy();
      expect(response.headers()["content-type"]).toContain("application/zip");
      expect(response.headers()["content-disposition"]).toContain(filename);
      expect(response.headers()["x-wiki-cache-scope"]).toBe("public");
      const zip = await JSZip.loadAsync(await response.body());
      const entries = Object.keys(zip.files);
      const markdown = entries.filter((entry) => entry.endsWith(".md"));
      expect(markdown.length, query).toBeGreaterThan(0);
      for (const entry of markdown) {
        const text = await zip.file(entry)!.async("string");
        expect(text, `${query} ${entry}`).not.toMatch(RAW_IDENTIFIERS);
        expect(text, `${query} ${entry}`).not.toContain(`sensmark${nonce}`);
      }
      expect(entries.some((entry) => entry.includes(sensitive.slug.split("/").pop()!)), `${query} sensitive entry`).toBe(false);
      if (query.startsWith("type=full")) expect(entries.some((entry) => entry.endsWith(".pdf")), "full archive carries a PDF").toBe(true);
    }
  } finally {
    await reader.dispose();
  }
});
