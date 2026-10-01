import { expect, test } from "@playwright/test";
import { makePublicWikiSessionIdentity, WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";

test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-wiki-test-run": "1" } });
test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Requires the standalone app-shell password gate.");
const slug = "wiki/education/oncology-101/index";
const route = `/${slug}`;

test("guests can read, browse, search, and view cartoons without a password", async ({ page, request }) => {
  test.setTimeout(60_000);
  const manifest = await (await request.get("/api/wiki/manifest")).json();
  expect(manifest.pages.length).toBeGreaterThan(0);
  expect(manifest.pages.every((page: { slug: string; sensitive: boolean }) =>
    page.slug.startsWith("wiki/education/") && !page.sensitive)).toBe(true);
  // The text-search API can return a partial indexed response while warming.
  await expect.poll(async () => {
    const search = await (await request.get("/api/search?q=immunotherapy")).json();
    expect(search.results.every((page: { slug: string }) => page.slug.startsWith("wiki/education/"))).toBe(true);
    return search.results.length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.goto(route);
  await expect(page.getByRole("heading", { name: /Oncology 101/, level: 1 })).toBeVisible();
  const cartoon = page.getByRole("img", { name: "immune recognition cartoon", exact: true });
  await cartoon.scrollIntoViewIfNeeded();
  await expect.poll(() => cartoon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("link", { name: "Diagnostics", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("a remembered full-wiki cache cannot paint in the education guest reader", async ({ page, request, baseURL }) => {
  const manifest = await (await request.get("/api/wiki/manifest")).json();
  const batch = await (await request.get(`/api/wiki/pages?slugs=${slug}`)).json();
  const origin = new URL(baseURL!).origin;
  const partition = `${origin}|${origin}`;
  const marker = "Previously authorized care cache must not render";
  const snapshot = { version: 1, partition, readerVersion: WIKI_READER_CACHE_VERSION,
    identity: makePublicWikiSessionIdentity("diana"), accountTag: "public", validatedAt: Date.now(), manifest,
    bodies: [{ pathname: route, fetchedAt: Date.now(), page: { ...batch.pages[0], content: `# ${marker}` } }] };
  await page.addInitScript(({ key, snapshot, marker }) => {
    localStorage.setItem(key, JSON.stringify(snapshot));
    (window as unknown as { educationCacheLeak: boolean }).educationCacheLeak = false;
    new MutationObserver(() => {
      if (document.body?.innerText.includes(marker)) (window as unknown as { educationCacheLeak: boolean }).educationCacheLeak = true;
    }).observe(document, { childList: true, subtree: true });
  }, { key: `wiki-vite:startup:${WIKI_READER_CACHE_VERSION}:${partition}`, snapshot, marker });
  await page.goto(route);
  await expect(page.getByRole("heading", { name: /Oncology 101/, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse education", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { educationCacheLeak: boolean }).educationCacheLeak)).toBe(false);
});

test("education remains readable on a phone and protected APIs still deny guests", async ({ page, request }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(route);
  await expect(page.getByRole("heading", { name: /Oncology 101/, level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const endpoint of ["/api/timeline", "/api/diagnostic-studies", "/api/wiki/convex-token",
    "/api/wiki/pages?slugs=wiki/care/index", "/api/download", "/api/chat"]) {
    const response = await request.get(endpoint);
    expect(response.status(), endpoint).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }
});
