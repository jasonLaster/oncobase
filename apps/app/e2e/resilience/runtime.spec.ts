import { expect, type Page } from "@playwright/test";
import { makePublicWikiSessionIdentity, makeWikiStoreId } from "@oncobase/wiki-content";
import { documentArticle, gotoWiki, installWikiApiMocks, readerShellHtml, waitForPageTitle } from "../fixtures";
import { test } from "../persistent-reader-fixture";

// Tier B reader resilience: one browser test per distinct failure class.
// Latency budgets (reader-performance, table-performance, page-load) are not
// asserted here; they belong in scripts/profile-*.ts.
const ROUTE = "/wiki/logistics/insurance";
const slug = "wiki/logistics/insurance";

async function ready(page: Page) {
  await expect(page.locator('#root [data-test-id="document-article"]')).toContainText("Prior authorization", { timeout: 25_000 });
  await expect(page.getByTestId("sidebar-search")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-wiki-first-frame", "true");
}

async function openPalette(page: Page) {
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
}

// A cold CSR document without a seeded article or navigation.
async function coldDocuments(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const html = await readerShellHtml(page);
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fallback());
}

// Distinct body slugs requested so far. The reader may issue the same body
// request more than once concurrently; what must hold is which documents it asks for.
const requestedSlugs = (urls: string[]) => [...new Set(urls.map(url => new URL(url).searchParams.get("slugs")))];
const requestsFor = (urls: string[], target: string) => urls.filter(url => new URL(url).searchParams.get("slugs") === target).length;

async function rank(page: Page, slugs = [slug]) {
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

test("an orphaned leader lock falls back without stealing the lock or deleting data", async ({ page, context, baseURL }) => {
  test.setTimeout(60_000);
  const holder = await context.newPage();
  await holder.route("**/__lock-holder", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Lock fixture</title>" }));
  await holder.goto(`${baseURL}/__lock-holder`);
  const identity = makePublicWikiSessionIdentity("diana");
  const storeId = makeWikiStoreId({ siteSlug: "diana", scope: "public", origin: new URL(baseURL!).origin, cacheKey: identity.cacheKey });
  const lockName = `livestore-tab-lock-${storeId}`;
  await holder.evaluate(async name => {
    const root = await navigator.storage.getDirectory();
    const sentinel = await root.getFileHandle("startup-test-sentinel", { create: true });
    const stream = await sentinel.createWritable();
    await stream.write("preserve me");
    await stream.close();
    await new Promise<void>(resolve => {
      void navigator.locks.request(name, () => {
        resolve();
        return new Promise<void>(() => {});
      });
    });
  }, lockName);
  const warnings: string[] = [];
  page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await installWikiApiMocks(page);
  await page.goto(ROUTE);
  await ready(page);
  expect(warnings.some(message => message.includes("startup timed out"))).toBe(true);
  expect(await holder.evaluate(async name => (await navigator.locks.query()).held?.some(lock => lock.name === name), lockName)).toBe(true);
  expect(await holder.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle("startup-test-sentinel")).getFile()).text())).toBe("preserve me");
  // Closing the holder must not cause the abandoned boot to acquire the lock.
  await holder.close();
  await expect.poll(async () => page.evaluate(async name => {
    const locks = await navigator.locks.query();
    return [...(locks.held ?? []), ...(locks.pending ?? [])].filter(lock => lock.name === name).length;
  }, lockName)).toBe(0);
  await openPalette(page);
  await page.keyboard.press("Escape");
  await page.reload();
  await ready(page);
});

test("healthy follower tabs and leader handoff do not need fallback", async ({ page, context, browserName }) => {
  test.setTimeout(60_000);
  const warnings: string[] = [];
  await installWikiApiMocks(page);
  await gotoWiki(page, ROUTE);
  const copiedSession = await page.evaluate(() => ({ ...sessionStorage }));
  const follower = await context.newPage();
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(follower);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  // Model Duplicate Tab / window.open copying sessionStorage from its opener.
  await follower.addInitScript(values => {
    for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value);
  }, copiedSession);
  follower.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await installWikiApiMocks(follower);
  await gotoWiki(follower, ROUTE);
  await page.close();
  await follower.reload();
  await ready(follower);
  // Exercise fast reload and former leader shutdown overlap repeatedly.
  for (let index = 0; index < 3; index++) await follower.reload({ waitUntil: "domcontentloaded" });
  await ready(follower);
  await follower.clock.fastForward(16_000);
  await ready(follower);
  expect(warnings.filter(message => message.includes("startup timed out"))).toEqual([]);
});

test("a new worker version cannot strand a tab behind the old version's leader", async ({ page, context }) => {
  test.setTimeout(60_000);
  await installWikiApiMocks(page);
  await gotoWiki(page, ROUTE);
  const newer = await context.newPage();
  const warnings: string[] = [];
  newer.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await newer.addInitScript(() => {
    const RealSharedWorker = window.SharedWorker;
    window.SharedWorker = class extends RealSharedWorker {
      constructor(url: string | URL, options?: string | WorkerOptions) {
        const versioned = new URL(url, location.href);
        versioned.searchParams.set("startup-test-version", "next");
        super(versioned, options);
      }
    };
  });
  await installWikiApiMocks(newer);
  const storePaths: string[] = [];
  await newer.route("**/api/wiki/telemetry", async route => {
    try {
      for (const span of JSON.parse(route.request().postData() ?? "{}").spans ?? []) if (span.name === "store-adapter") storePaths.push(span.path);
    } catch { /* Not a reader batch. */ }
    await route.fulfill({ status: 204 });
  });
  await newer.goto(ROUTE);
  await ready(newer);
  // The newer tab never reaches the old version's leader. It either boots from
  // the guarded local OPFS snapshot or times out into temporary storage.
  // Either way it must not be stranded.
  await expect.poll(() => warnings.some(message => message.includes("startup timed out")) || storePaths.includes("fast"),
    { timeout: 40_000 }).toBe(true);
  await openPalette(newer);
  await newer.keyboard.press("Escape");
  await openPalette(page);
});

test("a stalled temporary store ends in one visible recovery screen instead of a reload loop", async ({ page }) => {
  test.setTimeout(60_000);
  await installWikiApiMocks(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
  });
  await page.route("**/*.wasm*", () => {});
  let navigations = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  await page.goto(ROUTE);
  await expect(page.getByTestId("store-startup-recovery")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
  await expect(page.getByTestId("app-starting")).toHaveCount(0);
  expect(navigations).toBe(1);
});

test("unavailable persistent storage still permits reading, navigation and reload, and keeps scopes separate", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { getDirectory: async () => { throw new DOMException("Storage denied", "UnknownError"); } },
    });
  });
  const errors: string[] = [];
  const captureError = (error: Error) => { errors.push(error.message); };
  page.on("pageerror", captureError);
  await installWikiApiMocks(page);
  await gotoWiki(page, ROUTE);
  await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  await openPalette(page);
  await page.getByTestId("command-palette-input").fill("terminology");
  await page.getByTestId("command-palette").getByRole("option", { name: /terminology/i }).first().click();
  await expect(page).toHaveURL(/\/about\/Terminology$/);
  await expect(page.getByTestId("document-article")).toContainText("BRCA");
  expect(errors).toEqual([]);
  // WebKit reports aborted background warm fetches as access-control errors
  // during unload. Check the mounted reader's errors before that teardown.
  page.off("pageerror", captureError);
  await page.reload();
  await expect(page.getByTestId("document-article")).toContainText("BRCA");

  // Temporary storage keeps public and session content separate.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installWikiApiMocks(page, { sessionAuthenticated: true });
  await gotoWiki(page, "/private/plan?scope=session");
  await expect(page.getByTestId("document-article")).toContainText("Sensitive session-only planning note");
  await gotoWiki(page, "/private/plan?scope=public");
  await expect(page.getByTestId("document-article").locator("h1")).toHaveText("This page may be restricted");
  await expect(page.getByTestId("document-article")).not.toContainText("Sensitive session-only planning note");
  await openPalette(page);
  await page.getByTestId("command-palette-input").fill("private plan");
  await expect(page.getByText("No pages found")).toBeVisible();
});

test("a failed chunk reloads once then shows the recovery screen", async ({ page }) => {
  await installWikiApiMocks(page);
  // The first failure of the lazy shell auto-reloads once; the reload fails
  // again and, with the reload guard spent, must surface the recovery screen.
  await page.route(/LiveStoreRoot/, route => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const recovery = page.getByTestId("app-recovery");
  await expect(recovery).toBeVisible({ timeout: 20_000 });
  await expect(recovery).toContainText("The reader needs to reload");
  await expect(page.getByTestId("app-recovery-reload")).toBeVisible();
  expect((await page.locator("#root").innerHTML()).length).toBeGreaterThan(0);
});

test("a slow body offers a retry that cancels the first request; a failed body retries on reconnect", async ({ page, context }) => {
  test.setTimeout(60_000);
  await coldDocuments(page);
  await installWikiApiMocks(page);
  let attempts = 0;
  let retried = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/pages**", async route => {
    if (new URL(route.request().url()).searchParams.get("slugs") !== slug) return route.fallback();
    attempts++;
    // Everything requested before the retry stays pending.
    if (!retried) await held;
    return route.fallback();
  });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const state = { aborted: 0 };
    Object.assign(window, { readerPageRequests: state });
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (url.includes("/api/wiki/pages")) signal?.addEventListener("abort", () => state.aborted++, { once: true });
      return original(input, init);
    };
  });
  try {
    await page.goto(`/${slug}`);
    await expect(page.getByTestId("page-activity")).toContainText("Taking longer than usual", { timeout: 15_000 });
    const retry = page.getByTestId("page-activity").getByRole("button", { name: "Try again" });
    await expect(retry).toBeInViewport();
    const before = attempts;
    retried = true;
    await retry.click();
    await waitForPageTitle(page, "Insurance");
    await expect.poll(() => page.evaluate(() => (window as unknown as { readerPageRequests: { aborted: number } }).readerPageRequests.aborted)).toBeGreaterThan(0);
    expect(attempts).toBeGreaterThan(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
  await page.close();

  // The first half cached Insurance in this profile's store; use an uncached page.
  const failing = await context.newPage();
  await coldDocuments(failing);
  const requests = await installWikiApiMocks(failing);
  requests.setPageFailure("about/About", true);
  await failing.goto("/about/About");
  await expect(failing.getByTestId("retry-page-fetch")).toBeVisible();
  await context.setOffline(true);
  requests.setPageFailure("about/About", 0);
  await context.setOffline(false);
  await waitForPageTitle(failing, "About This Wiki");
});

test("a stalled manifest leaves the body readable and navigation recovers automatically", async ({ page }) => {
  await coldDocuments(page);
  const requests = await installWikiApiMocks(page);
  requests.setManifestFailure(true);
  await page.goto(`/${slug}?devtools=1`);
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
  const failedFetches = requests.manifest.length;
  requests.setManifestFailure(false);
  await expect.poll(() => requests.manifest.length, { timeout: 10_000 }).toBeGreaterThan(failedFetches);
  await expect(page.locator('[data-test-id="navigation-status"]').first()).toHaveAttribute("data-freshness", "current");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
});

test("prefetch never blocks or outlives navigation, and pauses on save-data and hidden", async ({ page, context }) => {
  test.setTimeout(60_000);
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
    if (new URL(route.request().url()).searchParams.get("slugs") === slug) { pending = true; await held; }
    await route.fallback();
  });
  try {
    await gotoWiki(page, "/");
    await expect.poll(() => pending).toBe(true);
    await documentArticle(page).getByRole("link", { name: "Next", exact: true }).click();
    await waitForPageTitle(page, "About This Wiki");
    // Observe actual fetch cancellation before releasing the held response.
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __prefetchAbort: { signal: boolean; rejected: boolean } }
    ).__prefetchAbort)).toEqual({ signal: true, rejected: true });
  } finally { release(); }
  await page.close();

  for (const mode of ["save-data", "hidden"] as const) {
    const paused = await context.newPage();
    await paused.addInitScript(mode => {
      if (mode === "save-data") Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
      if (mode === "hidden") Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    }, mode);
    const requests = await installWikiApiMocks(paused);
    const popularity = await rank(paused);
    await gotoWiki(paused, "/");
    await expect(paused.waitForRequest(request => request.url().includes("/api/wiki/prefetch"), { timeout: 3500 })).rejects.toThrow(/Timeout/);
    expect(popularity.reads()).toBe(0);
    expect(requestedSlugs(requests.pages)).toEqual(["index"]);
    await paused.close();
  }
});

test("hover intent warms a document from cache, but brief hover and external links never speculate", async ({ page }) => {
  const overrides = { index: { content: "# Home\n\n[Insurance](/wiki/logistics/insurance)\n\n[External](https://example.com/wiki/logistics/insurance)\n\n[Unknown](/not-in-the-manifest)" } };
  const requests = await installWikiApiMocks(page, { pageOverrides: overrides });
  await gotoWiki(page, "/");
  // Brief hover (over then out), external and unknown links: no body request.
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('a[href="/wiki/logistics/insurance"]')!;
    link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    link.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
  });
  await documentArticle(page).getByRole("link", { name: "External", exact: true }).focus();
  await documentArticle(page).getByRole("link", { name: "Unknown", exact: true }).focus();
  await expect(page.waitForRequest(request => new URL(request.url()).searchParams.get("slugs") === slug, { timeout: 1000 })).rejects.toThrow(/Timeout/);
  expect(requestedSlugs(requests.pages)).toEqual(["index"]);
  // Sustained intent warms the body; the destination then comes from LiveStore.
  const link = documentArticle(page).getByRole("link", { name: "Insurance", exact: true });
  const warmed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/wiki/pages" && new URL(response.url()).searchParams.get("slugs") === slug);
  await link.hover();
  await (await warmed).finished();
  await expect.poll(() => requestsFor(requests.pages, slug)).toBe(1);
  await page.route("**/api/wiki/pages**", route => route.abort());
  await link.click();
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  expect(requestsFor(requests.pages, slug)).toBe(1);
});

test("the search shortcut survives refreshing an unknown deep link before scripts load", async ({ page }) => {
  await installWikiApiMocks(page);
  let pauseScripts = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (pauseScripts && route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  // An unknown deep link renders not-found after the manifest syncs.
  await gotoWiki(page, "/wiki/missing/not-here");
  await expect(documentArticle(page).locator("h1")).toHaveText("This page may be restricted");
  await expect(documentArticle(page)).toContainText("Sign in to check access");
  await expect(documentArticle(page).getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  try {
    pauseScripts = true;
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("#wiki-reader-shortcuts")).toHaveCount(1);
    await expect(page.getByTestId("app-starting")).toBeVisible();
    await page.keyboard.press("Control+K");
    // The chord can span the transition from inline listener to React.
    release();
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await input.fill("insurance");
    await expect(page.getByRole("option").first()).toContainText("insurance");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await expect(input).toHaveCount(0);
  } finally { release(); }
});

test("a large virtualized tree keeps focus and every file reachable by keyboard", async ({ page }) => {
  const pages = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [
    `wiki/performance/page-${String(index).padStart(4, "0")}`,
    { title: `Performance page ${index}`, content: `# Performance page ${index}\n\nSynthetic large-tree document ${index}.`, tags: ["performance"] },
  ]));
  await installWikiApiMocks(page, { pageOverrides: pages });
  await gotoWiki(page, ROUTE);
  const navigation = page.getByTestId("sidebar-tree");
  await navigation.getByRole("button", { name: "Expand performance", exact: true }).focus();
  await page.keyboard.press("Enter");
  const tree = navigation.locator(".wiki-shell-tree-root");
  await expect(tree).toHaveAttribute("data-virtualized", "true");
  await expect(navigation.getByRole("button", { name: "Collapse performance", exact: true })).toBeFocused();
  await expect.poll(() => tree.locator("[data-tree-row]").count()).toBeLessThan(90);
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "page 0000", exact: true })).toBeFocused();
  for (let index = 0; index < 40; index++) await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "page 0040", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(navigation.getByRole("link", { name: "page 0039", exact: true })).toBeFocused();
  await navigation.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const last = navigation.getByRole("link", { name: "page 0799", exact: true });
  await expect(last).toBeVisible();
  await last.click();
  await waitForPageTitle(page, "Performance page 799");
  await navigation.evaluate(element => { element.scrollTop = 0; });
  await navigation.getByRole("button", { name: "Collapse performance", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(navigation.getByRole("button", { name: "Expand performance", exact: true })).toBeFocused();
  await expect(tree).not.toHaveAttribute("data-virtualized", "true");
});
