import { expect, type Page } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

async function rank(page: Page, slugs = ["wiki/logistics/insurance"]) {
  const visits: string[] = [];
  let reads = 0;
  await page.route("**/api/wiki/prefetch**", async route => {
    if (route.request().method() === "POST") {
      visits.push(route.request().postDataJSON().slug);
      await route.fulfill({ status: 204 });
    } else { reads++; await route.fulfill({ json: { enabled: true, slugs } }); }
  });
  return { visits, reads: () => reads };
}

test("ranked unvisited bodies warm in the background and navigate from cache without another fetch", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  const popularity = await rank(page);
  await gotoWiki(page, "/");
  const prefetched = page.waitForResponse(response => new URL(response.url()).pathname === "/api/wiki/pages" && new URL(response.url()).searchParams.get("slugs") === "wiki/logistics/insurance");
  await (await prefetched).finished();
  // A subsequent idle cycle means the response has been materialized.
  await expect.poll(() => requests.pages.length).toBe(2);
  await page.route("**/api/wiki/pages**", route => route.abort());
  await documentArticle(page).getByRole("link", { name: "Insurance", exact: true }).click();
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
  expect(requests.pages).toHaveLength(2);
  expect(popularity.visits).toEqual(["index"]);
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("prefetched-navigation.png") });
});

test("the active body completes before ranking or prefetch work begins", async ({ page }) => {
  await installWikiApiMocks(page);
  const popularity = await rank(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/pages**", async route => { await held; await route.fallback(); });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-loading")).toBeVisible();
    await expect(page.waitForRequest(request => request.url().includes("/api/wiki/prefetch"), { timeout: 2500 })).rejects.toThrow(/Timeout/);
    expect(popularity.reads()).toBe(0);
  } finally { release(); }
  await waitForPageTitle(page, "Diana Wiki Home");
  await expect.poll(popularity.reads).toBe(1);
});

test("a stale active body revalidates before background requests resume", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  const popularity = await rank(page);
  await gotoWiki(page, "/");
  requests.setPageOverride("index", { content: "# Home\n\nUpdated active body" });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/pages**", async route => {
    if (new URL(route.request().url()).searchParams.get("slugs") === "index") await held;
    await route.fallback();
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(page.getByText("Showing cached markdown while a newer version is fetched in the background.")).toBeVisible();
    await expect(page.waitForRequest(request => request.url().includes("/api/wiki/prefetch"), { timeout: 3500 })).rejects.toThrow(/Timeout/);
    expect(popularity.reads()).toBe(0);
  } finally { release(); }
  await expect(documentArticle(page)).toContainText("Updated active body");
  await expect.poll(popularity.reads).toBe(1);
});

test("navigation retries an interrupted ranking request without a five-minute delay", async ({ page }) => {
  await installWikiApiMocks(page, { pageOverrides: { index: { content: "# Home\n\n[Next](/about/About)" } } });
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/prefetch**", async route => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 204 });
      return;
    }
    reads++;
    if (reads === 1) await held;
    await route.fulfill({ json: { enabled: true, slugs: [] } });
  });
  try {
    await gotoWiki(page, "/");
    await expect.poll(() => reads).toBe(1);
    await documentArticle(page).getByRole("link", { name: "Next", exact: true }).click();
    await waitForPageTitle(page, "About This Wiki");
    await expect.poll(() => reads, { timeout: 10_000 }).toBe(2);
  } finally { release(); }
});

test("navigation cancels background work and does not wait behind it", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { signal: false, rejected: false };
    Object.defineProperty(window, "__prefetchAbort", { value: probe });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const watched = url.pathname === "/api/wiki/pages" && url.searchParams.get("slugs") === "wiki/logistics/insurance";
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      if (watched && signal) {
        probe.signal = signal.aborted;
        signal.addEventListener("abort", () => { probe.signal = true; }, { once: true });
      }
      return originalFetch(input, init).catch(error => {
        if (watched && signal?.aborted) probe.rejected = true;
        throw error;
      });
    };
  });
  await installWikiApiMocks(page, { pageOverrides: { index: { content: "# Home\n\n[Next](/about/About)" } } });
  await rank(page);
  let release!: () => void;
  let pending = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/pages**", async route => {
    if (new URL(route.request().url()).searchParams.get("slugs") === "wiki/logistics/insurance") { pending = true; await held; }
    await route.fallback();
  });
  try {
    await gotoWiki(page, "/");
    await expect.poll(() => pending).toBe(true);
    await documentArticle(page).getByRole("link", { name: "Next", exact: true }).click();
    await waitForPageTitle(page, "About This Wiki");
    // Observe actual fetch cancellation before releasing the intercepted
    // response; WebKit's network requestfailed notification can arrive later.
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __prefetchAbort: { signal: boolean; rejected: boolean } }
    ).__prefetchAbort)).toEqual({ signal: true, rejected: true });
  } finally { release(); }
});

for (const mode of ["save-data", "hidden", "pressure"] as const) {
  test(`background fetching pauses for ${mode}`, async ({ page }) => {
    await page.addInitScript(mode => {
      if (mode === "save-data") Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
      if (mode === "hidden") Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      if (mode === "pressure") {
        const storage = navigator.storage;
        Object.defineProperty(navigator, "storage", { get: () => storage });
        storage.estimate = async () => ({ usage: 90, quota: 100 });
      }
    }, mode);
    const requests = await installWikiApiMocks(page);
    const popularity = await rank(page);
    await gotoWiki(page, "/");
    await expect(page.waitForRequest(request => request.url().includes("/api/wiki/prefetch"), { timeout: 3500 })).rejects.toThrow(/Timeout/);
    expect(popularity.reads()).toBe(0);
    expect(requests.pages).toHaveLength(1);
  });
}

test("a cached stale body stays visible until its new version hot-swaps", async ({ page }) => {
  const slug = "wiki/logistics/insurance";
  const requests = await installWikiApiMocks(page, { pageOverrides: { [slug]: { content: "# Insurance\n\nOLD visible body" } } });
  await rank(page, []);
  await gotoWiki(page, `/${slug}`);
  await expect(documentArticle(page)).toContainText("OLD visible body");
  requests.setPageOverride(slug, { content: "# Insurance\n\nNEW updated body" });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/pages**", async route => { await held; await route.fallback(); });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(page.getByText("Showing cached markdown while a newer version is fetched in the background.")).toBeVisible();
    await expect(documentArticle(page)).toContainText("OLD visible body");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("stale-visible.png") });
  } finally { release(); }
  await expect(documentArticle(page)).toContainText("NEW updated body");
  await expect(documentArticle(page)).not.toContainText("OLD visible body");
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("stale-replaced.png") });
});
