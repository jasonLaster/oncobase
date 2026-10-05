// Tier B: reader identity / cache / manifest startup state machines.
// One browser test per distinct failure class. Permutations of the same class
// (public vs private, with/without a held identity, extra viewport widths, flag
// opt-outs) belong in unit tests on the startup/identity reducers.
import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { buildCompactTreeFromManifest, WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { injectPageBootstrap } from "../../server/page-bootstrap";
import { installVisualStabilityObserver } from "../../src/visual-stability";
import { test } from "../persistent-reader-fixture";
import { documentArticle, gotoWiki, installWikiApiMocks, readerShellHtml, waitForPageTitle } from "../fixtures";
import { assertAdditivePaint, installPaintMonitor } from "../paint-monitor";

const REFRESH_MANIFEST_EVENT = "wiki-vite:refresh-manifest";
const PUBLIC_MANIFEST_FRESH_MS = 60_000;
const insuranceSlug = "wiki/logistics/insurance";
const runsWithPreviewAuth = Boolean(process.env.PLAYWRIGHT_BASE_URL && process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD);

// ---------------------------------------------------------------------------
// Cached-startup harness: remembered page + tree paint from localStorage before
// identity resolves; the document is served with a controllable account tag.
// ---------------------------------------------------------------------------
const cachedBody = "# Cached reader\n\nCACHED_BODY\n\n" + "Stable paragraph for selection and scroll.\n\n".repeat(80);
const cachedQuery = "?paintDebug=1&readerStorage=memory";
async function setupCached(page: Page, privatePage = false) {
  const api = await installWikiApiMocks(page, { sessionAuthenticated: true, pageOverrides: { index: { content: cachedBody, sensitive: privatePage } } });
  let accountTag = "account-a";
  const html = await readerShellHtml(page);
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html.replace("</head>", `<meta name="wiki-reader-account" content="${accountTag}" /></head>`) }) : route.fallback());
  return { ...api, setHtmlAccount: (tag: string) => { accountTag = tag; } };
}
async function waitForCache(page: Page, text = "CACHED_BODY") {
  await expect.poll(() => page.evaluate(text => Object.keys(localStorage).some(key =>
    key.startsWith("wiki-vite:startup:") && localStorage.getItem(key)?.includes(text)), text)).toBe(true);
}
const hasStartupCache = (page: Page, text?: string) => page.evaluate(text => Object.keys(localStorage).some(key =>
  key.startsWith("wiki-vite:startup:") && (!text || localStorage.getItem(key)?.includes(text))), text);
async function holdIdentity(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/session**", async route => { await gate; await route.fallback(); });
  return release;
}

// ---------------------------------------------------------------------------
// Early-reader harness: the HTML response carries the page + navigation, the
// storage probe is held until the test releases it.
// ---------------------------------------------------------------------------
const earlyContent = "# Early reader\n\nEARLY_READER_BODY\n\n[Insurance](/wiki/logistics/insurance)\n\n" + "Stable text for selection and scrolling.\n\n".repeat(80);
const earlyRecord = { slug: "index", title: "Early reader", content: earlyContent, sensitive: false, tags: [],
  contentHash: createHash("sha256").update(earlyContent).digest("hex").slice(0, 24) };
async function setupEarly(page: Page, authenticated: boolean) {
  const api = await installWikiApiMocks(page, { sessionAuthenticated: authenticated, pageOverrides: { index: earlyRecord } });
  const template = await readerShellHtml(page);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
    const tree = buildCompactTreeFromManifest(["index", "wiki/logistics/insurance"].map(slug => ({
      slug, title: slug === "index" ? "Early reader" : "Insurance", description: null,
      contentHash: "fixture", tags: [], sensitive: false, size: 1,
    })), []);
    const navigation = JSON.stringify({ version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
      origin: url.origin, pathname: url.pathname, siteSlug: "diana", scope: "public", tree });
    const html = injectPageBootstrap(template, earlyRecord, url, "diana").replace("</body>",
      `<script id="wiki-navigation-bootstrap" type="application/json">${navigation}</script><script>document.getElementById('wiki-navigation-bootstrap').dataset.receivedAt=String(Date.now())</script></body>`);
    await route.fulfill({ contentType: "text/html", body: html });
  });
  // Pause only this synthetic context's storage probe; the real adapter starts once released.
  await page.addInitScript(() => {
    const getDirectory = navigator.storage.getDirectory.bind(navigator.storage);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.defineProperty(navigator.storage, "getDirectory", { configurable: true, value: () => gate.then(getDirectory) });
    Object.assign(window, { releaseReaderStorage: release });
  });
  return api;
}
const releaseStorage = (page: Page) => page.evaluate(() => (window as unknown as { releaseReaderStorage: () => void }).releaseReaderStorage());
const handoffCount = (page: Page) => page.evaluate(() => performance.getEntriesByName("wiki-reader-live-handoff").length);
const adapterStarts = (page: Page) => page.evaluate(() => performance.getEntriesByName("livestore:makeAdapter:start").length);
async function holdIdentityTracked(page: Page) {
  let release!: () => void;
  let pending = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/session**", async route => { pending = true; await gate; await route.fallback(); });
  return { release, pending: () => pending };
}

// ---------------------------------------------------------------------------
// Visual-observer helpers (late identity handoff outcome).
// ---------------------------------------------------------------------------
const handoffOutcome = (page: Page) => page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report().events
  .find((event) => event.kind === "phase:session-handoff")?.data?.outcome ?? null);
const identityReadyAt = (page: Page, scope: "public" | "session") => page.evaluate((scope) => window.__WIKI_VISUAL_STABILITY__!.report().events
  .find((event) => event.kind === "phase:identity-ready" && event.data?.scope === scope)?.at ?? null, scope);

// 1 ---------------------------------------------------------------------------
test("cached page and file tree paint before identity resolves and survive the store handoff", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await setupCached(page, true);
  await page.goto(`/${cachedQuery}`);
  await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
  await waitForCache(page);
  const release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const article = page.getByTestId("document-article");
    await expect(article).toContainText("CACHED_BODY");
    await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "false");
    await expect(page.getByTestId("wiki-sidebar").getByTestId("navigation-status")).toHaveAttribute("data-freshness", "checking");
    const original = await article.elementHandle();
    const sidebar = await page.getByTestId("wiki-sidebar").elementHandle();
    await page.getByTestId("sidebar-search").click();
    const input = page.getByTestId("command-palette").locator("input");
    await input.fill("Insurance");
    await expect(page.getByTestId("command-palette")).toContainText(/insurance/i);
    const inputNode = await input.elementHandle();
    release();
    await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "true");
    await expect(page.getByTestId("wiki-sidebar").getByTestId("navigation-status")).toHaveAttribute("data-freshness", "current");
    expect(await original!.evaluate(node => node.isConnected)).toBe(true);
    expect(await sidebar!.evaluate(node => node.isConnected)).toBe(true);
    expect(await inputNode!.evaluate(node => node.isConnected && node === document.activeElement)).toBe(true);
    await expect(input).toHaveValue("Insurance");
    expect(errors).toEqual([]);
  } finally { release(); }
});

// 2 ---------------------------------------------------------------------------
test("a changed account discards the previous cache before its store opens, including when the HTML names the account", async ({ page }) => {
  const api = await setupCached(page, true);
  await page.goto(`/${cachedQuery}`); await waitForCache(page);
  // Late identity (session response) names a different account.
  api.setSessionCacheKey("different-account-key", "different-user");
  api.setPageOverride("index", { content: "# New account\n\nOTHER_ACCOUNT_BODY" });
  let release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    release();
    await expect(page.getByTestId("document-article")).toContainText("OTHER_ACCOUNT_BODY");
    await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
    await waitForCache(page, "OTHER_ACCOUNT_BODY");
    expect(await hasStartupCache(page, "CACHED_BODY")).toBe(false);
  } finally { release(); }
  // The HTML itself names another account: the old cache must never paint.
  api.setSessionCacheKey("account-b", "user-b");
  api.setHtmlAccount("account-b");
  api.setPageOverride("index", { content: "# B\n\nACCOUNT_B_BODY" });
  release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reader-pending")).toBeVisible();
    await expect(page.getByTestId("document-article")).toHaveCount(0);
    release();
    await expect(page.getByTestId("document-article")).toContainText("ACCOUNT_B_BODY");
    await expect(page.getByTestId("document-article")).not.toContainText("OTHER_ACCOUNT_BODY");
  } finally { release(); }
});

// 3 ---------------------------------------------------------------------------
test("confirmed session denial removes the cached body and tree and offers sign-in", async ({ page }) => {
  await setupCached(page, true);
  await page.goto(`/${cachedQuery}&scope=session`); await waitForCache(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/session**", async route => { await gate; await route.fulfill({ status: 401, json: { error: "Session expired" } }); });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    release();
    await expect(page.getByTestId("session-recovery")).toBeVisible();
    await expect(page.getByTestId("document-article")).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
    expect(await hasStartupCache(page)).toBe(false);
    await expect(page.getByRole("link", { name: "Open sign in" })).toHaveAttribute("href", /\/sign-in\?redirect=/);
  } finally { release(); }
});

// 4 ---------------------------------------------------------------------------
test("sign-out clears remembered private content and an invalidation from another tab removes it", async ({ page, context }) => {
  const api = await setupCached(page, true);
  await page.goto(`/${cachedQuery}`); await waitForCache(page);
  api.setSessionAuthenticated(false);
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-auth-session-change")));
  await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
  await expect.poll(() => hasStartupCache(page, "CACHED_BODY")).toBe(false);
  await page.reload();
  await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");

  // Remembered content again, then another tab invalidates it while identity is held.
  api.setSessionAuthenticated(true);
  await page.reload();
  await waitForCache(page);
  const release = await holdIdentity(page);
  const other = await context.newPage();
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    await other.goto(new URL("/favicon.svg", page.url()).toString());
    await other.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("wiki-vite:startup:")) localStorage.removeItem(key);
      localStorage.setItem("wiki-vite:startup-epoch", crypto.randomUUID());
    });
    await expect(page.getByTestId("document-article")).toHaveCount(0);
    await expect(page.getByTestId("reader-pending")).toBeVisible();
  } finally { release(); await other.close(); }
});

// 5 ---------------------------------------------------------------------------
test("a transient identity outage retains remembered content and cached navigation", async ({ page }) => {
  const api = await setupCached(page, true);
  await page.goto(`/${cachedQuery}`); await waitForCache(page);
  api.setSessionIdentityFailure(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
  await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "false");
  await expect(page.getByTestId("session-recovery")).toHaveCount(0);
  await page.getByTestId("sidebar-search").click();
  await page.getByTestId("command-palette").locator("input").fill("Insurance");
  await expect(page.getByTestId("command-palette")).toContainText(/insurance/i);
});

// 6 ---------------------------------------------------------------------------
test("manifest stale-while-revalidate: reload revalidates once, expiry revalidates without blanking, routes reuse it", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-30T12:00:00.000Z") });
  const manifestValidators: Array<string | undefined> = [];
  let initialEtag: string | undefined;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/wiki/manifest") manifestValidators.push(request.headers()["if-none-match"]);
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/wiki/manifest" && response.status() === 200) initialEtag = response.headers()["etag"];
  });
  const requests = await installWikiApiMocks(page, {
    pageOverrides: { [insuranceSlug]: { content: "# Insurance\n\nOLD TTL SNAPSHOT remains readable." } },
  });

  // The reader may issue more than one manifest request per cold load, so count
  // relative to a settled baseline instead of asserting absolute totals.
  const settled = async () => {
    let last = -1;
    while (last !== requests.manifest.length) {
      last = requests.manifest.length;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return last;
  };

  await gotoWiki(page, `/${insuranceSlug}`);
  await expect(documentArticle(page)).toContainText("OLD TTL SNAPSHOT");
  await expect.poll(() => initialEtag).toMatch(/^W\/"[a-f0-9]+"$/);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("wiki-vite:startup:")))).toBe(true);
  const afterCold = await settled();

  await page.clock.fastForward(PUBLIC_MANIFEST_FRESH_MS / 2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("OLD TTL SNAPSHOT");
  // A snapshot startup revalidates with the stored validator.
  await expect.poll(() => requests.manifest.length).toBeGreaterThan(afterCold);
  const afterReload = await settled();
  expect(manifestValidators[afterCold]).toBe(initialEtag);

  requests.setPageOverride(insuranceSlug, { content: "# Insurance\n\nNEW TTL SNAPSHOT arrived automatically." });
  requests.setManifestDelay(2_000);
  // The reload revalidated, so the snapshot expires a full TTL later.
  await page.clock.fastForward(PUBLIC_MANIFEST_FRESH_MS + 1);
  await expect.poll(() => requests.manifest.length).toBeGreaterThan(afterReload);
  expect(manifestValidators[afterReload]).toBe(initialEtag);
  await expect(documentArticle(page)).toContainText("OLD TTL SNAPSHOT");
  await expect(documentArticle(page)).toContainText("NEW TTL SNAPSHOT arrived automatically.", { timeout: 10_000 });
  await expect(documentArticle(page)).not.toContainText("OLD TTL SNAPSHOT");

  // Fresh manifest: a route change does not refetch it.
  const afterExpiry = await settled();
  await page.getByTestId("wiki-sidebar").getByRole("link", { name: "index", exact: true }).click();
  await waitForPageTitle(page, "Diana Wiki Home");
  expect(await settled()).toBe(afterExpiry);
});

// 7 ---------------------------------------------------------------------------
test("a failed or partial manifest refresh keeps the persisted snapshot readable", async ({ page }) => {
  const requests = await installWikiApiMocks(page, {
    pageOverrides: { [insuranceSlug]: { content: "# Insurance\n\nFALLBACK SNAPSHOT stays available." } },
  });
  await gotoWiki(page, `/${insuranceSlug}?devtools=1`);
  await expect(documentArticle(page)).toContainText("FALLBACK SNAPSHOT");
  const metric = () => page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.metrics?.message);

  requests.setManifestFailure(true);
  await page.evaluate((eventName) => { window.dispatchEvent(new Event(eventName)); }, REFRESH_MANIFEST_EVENT);
  await expect.poll(metric).toBe("Refresh failed; using cached manifest");
  await expect(documentArticle(page)).toContainText("FALLBACK SNAPSHOT");
  await expect(page.getByTestId("page-loading")).toHaveCount(0);

  requests.setManifestFailure(false);
  requests.setManifestPartial(true);
  await page.evaluate((eventName) => { window.dispatchEvent(new Event(eventName)); }, REFRESH_MANIFEST_EVENT);
  await expect.poll(metric).toBe("Partial refresh ignored; using complete cached manifest");
  await expect(documentArticle(page)).toContainText("FALLBACK SNAPSHOT");
  await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();
});

// 8 ---------------------------------------------------------------------------
test("a stale cached body hot-swaps to new markdown without resetting scroll or the sidebar", async ({ page }) => {
  const api = await setupCached(page);
  await page.goto(`/${cachedQuery}`); await waitForCache(page);
  api.setPageOverride("index", { content: cachedBody + "\n\nUPDATED_BODY" });
  const release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const article = page.getByTestId("document-article");
    await expect(article).toContainText("CACHED_BODY");
    await expect(article).not.toContainText("UPDATED_BODY");
    const sidebar = await page.getByTestId("wiki-sidebar").elementHandle();
    const before = await article.evaluate(element => {
      let node: Element | null = element;
      while (node && !(node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
      const scroll = node ?? document.scrollingElement!;
      scroll.scrollTop = 300;
      Object.assign(window, { swrScroll: scroll });
      return scroll.scrollTop;
    });
    expect(before).toBeGreaterThan(0);
    release();
    await expect(article).toContainText("UPDATED_BODY");
    expect(await sidebar!.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { swrScroll: Element }).swrScroll.scrollTop)).toBe(before);
    // (Searchability of a page added upstream after the swap is red on main; tracked in the report.)
    await waitForCache(page, "UPDATED_BODY");
  } finally { release(); }
});

// 9 ---------------------------------------------------------------------------
test("navigation during identity and store startup keeps the article mounted and lands on the requested page", async ({ page }) => {
  await setupEarly(page, true);
  const gate = await holdIdentityTracked(page);
  try {
    await page.goto("/?paintDebug=1", { waitUntil: "domcontentloaded" });
    const article = page.getByTestId("document-article");
    await expect(article).toContainText("EARLY_READER_BODY");
    const handle = await article.elementHandle();
    await article.getByRole("link", { name: "Insurance", exact: true }).click();
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance/);
    await expect(article).toContainText("EARLY_READER_BODY");
    expect(await adapterStarts(page)).toBe(0);
    gate.release();
    await releaseStorage(page);
    await expect(article).toContainText("Prior authorization");
    expect(await handle!.evaluate(node => node.isConnected)).toBe(true);
    await page.goBack();
    await expect(article).toContainText("EARLY_READER_BODY");
  } finally { gate.release(); }
});

// 10 --------------------------------------------------------------------------
test("public and session scopes keep separate stores, never leak restricted pages, and the switcher preserves the route", async ({ page }) => {
  await installWikiApiMocks(page, { sessionAuthenticated: true });
  await gotoWiki(page, "/private/plan?scope=session&devtools=1#claims-follow-up");
  await waitForPageTitle(page, "Private Plan");
  await expect(documentArticle(page)).toContainText("Sensitive session-only planning note");
  await expect(page.getByTestId("scope-switcher").getByRole("link", { name: "Public" })).toHaveAttribute(
    "href", /\/private\/plan\?scope=public&devtools=1#claims-follow-up$/);

  const sessionFooter = page.getByTestId("livestore-devtools-footer");
  await sessionFooter.locator("summary").click();
  const sessionStoreId = await sessionFooter.locator(".devtools-store").getAttribute("title");
  expect(sessionStoreId).toContain("session");

  await gotoWiki(page, "/private/plan?scope=public&devtools=1");
  await expect(documentArticle(page).locator("h1")).toHaveText("This page may be restricted");
  await expect(documentArticle(page)).not.toContainText("Sensitive session-only planning note");
  await page.getByTestId("sidebar-search").click();
  await page.getByTestId("command-palette-input").fill("private plan");
  await expect(page.getByText("No pages found")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toBeHidden();

  const publicFooter = page.getByTestId("livestore-devtools-footer");
  await publicFooter.locator("summary").click();
  const publicStoreId = await publicFooter.locator(".devtools-store").getAttribute("title");
  expect(publicStoreId).toContain("public");
  expect(publicStoreId).not.toBe(sessionStoreId);
});

// 11 --------------------------------------------------------------------------
test("cold load and cached reload paint additively (never blank) across desktop, saved-width and mobile layouts", async ({ context }, testInfo) => {
  testInfo.setTimeout(150_000);
  const slug = "sources/meeting-notes/09-06---laura-esserman-response-guided-surgery-overview";
  const title = "Response-guided surgery overview";
  for (const scenario of [
    { name: "desktop defaults", width: 1440, sidebar: 256, pane: "0", paneWidth: 384 },
    { name: "desktop saved widths", width: 1440, sidebar: 192, pane: "1", paneWidth: 300 },
    { name: "mobile", width: 390, sidebar: 256, pane: "0", paneWidth: 384 },
  ]) {
    await test.step(scenario.name, async () => {
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: scenario.width, height: 960 });
        await page.addInitScript((preferences) => {
          localStorage.setItem("sidebar-width", String(preferences.sidebar));
          localStorage.setItem("comments-pane-open", preferences.pane);
          localStorage.setItem("comments-pane-width", String(preferences.paneWidth));
        }, scenario);
        await installPaintMonitor(page);
        const requests = await installWikiApiMocks(page, {
          pageDelays: { [slug]: 600 },
          pageOverrides: {
            [slug]: { title, tags: [], content: `# ${title}\n\nPAINT_BODY_SENTINEL. This fixture exercises a static meeting note.\n\n## Questions\n\nKeep the document visible while its navigation and outline finish loading.` },
          },
        });
        // Delay the manifest on every load: a cached body must survive revalidation.
        await page.route("**/api/wiki/manifest**", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 700));
          await route.fallback();
        });
        for (const phase of ["cold", "cached"]) {
          if (phase === "cold") await page.goto(`/${slug}`, { waitUntil: "domcontentloaded" });
          else {
            // A cached reload still waits for React; never display inert controls.
            let release!: () => void;
            const held = new Promise<void>((resolve) => { release = resolve; });
            await page.route("**/*", async (route) => {
              if (route.request().resourceType() === "script") await held;
              await route.fallback();
            });
            try {
              await page.reload({ waitUntil: "commit" });
              await expect(page.locator("#wiki-first-frame-snapshot, #wiki-html-first")).toHaveCount(0);
              await expect(page.getByTestId("app-starting")).toBeVisible();
              await page.waitForTimeout(100);
            } finally { release(); }
          }
          await waitForPageTitle(page, title);
          await expect(documentArticle(page)).toContainText("PAINT_BODY_SENTINEL");
          await expect(page.locator("#wiki-first-frame-snapshot").filter({ visible: true })).toHaveCount(0);
          const manifestCount = requests.manifest.length;
          await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
          await expect.poll(() => requests.manifest.length).toBeGreaterThan(manifestCount);
          // Deliberate observation window: final-state assertions miss brief reversals.
          await page.waitForTimeout(1500);
          await assertAdditivePaint(page, testInfo, scenario.width < 768);
        }
      } finally { await page.close(); }
    });
  }
});

// 12 --------------------------------------------------------------------------
test("late identity for another account unmounts the cached session page immediately", async ({ page }) => {
  await page.addInitScript(installVisualStabilityObserver);
  const requests = await installWikiApiMocks(page, { sessionAuthenticated: true });
  await gotoWiki(page, `/${insuranceSlug}?scope=session`);
  await expect.poll(() => hasStartupCache(page), { timeout: 10_000 }).toBe(true);
  requests.setSessionCacheKey("diana:session:other-user:e2e", "other-user");
  requests.setPageOverride(insuranceSlug, { content: "# Insurance\n\nOTHER_ACCOUNT_SENTINEL" });
  await page.route("**/api/wiki/session**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fallback();
  });
  await page.goto(`/${insuranceSlug}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => identityReadyAt(page, "session")).not.toBeNull();
  await expect(documentArticle(page)).toContainText("OTHER_ACCOUNT_SENTINEL");
  expect(await handoffOutcome(page)).toBe("remount-required");
  const report = await page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
  const identityAt = (await identityReadyAt(page, "session"))!;
  // The previous account's page was taken down, not kept until the new store was ready.
  expect(report.events.some((event) => event.kind === "disappearance" && event.region === "body" && event.at >= identityAt)).toBe(true);
});

// 13 --------------------------------------------------------------------------
test("login preserves the redirect target and hash, and rejects absolute or protocol-relative redirects", async ({ page }) => {
  test.skip(runsWithPreviewAuth, "Preview e2e starts authenticated to exercise protected wiki pages.");
  await installWikiApiMocks(page);
  await page.route("**/api/login", async (route) => {
    const body = route.request().postDataJSON() as { password?: string };
    if (body.password === "diana") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    else await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Invalid password" }) });
  });
  const signIn = async () => {
    await page.getByPlaceholder("Password").fill("diana");
    await page.getByRole("button", { name: "Enter" }).click();
  };

  await page.goto("/login?redirect=%2Fwiki%2Flogistics%2Finsurance%3Fscope%3Dsession%23claims-follow-up", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Open Diana’s knowledge base." })).toBeVisible();
  await expect(page.getByTestId("app-header")).toHaveCount(0);
  await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
  await page.getByPlaceholder("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByText("Incorrect password")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toHaveValue("");
  await signIn();
  await expect(page).toHaveURL(/\/wiki\/logistics\/insurance\?scope=session#claims-follow-up$/);

  // A raw (unencoded) same-origin hash survives.
  await page.goto("/login?redirect=%2Fwiki%2Flogistics%2Finsurance#raw-heading", { waitUntil: "domcontentloaded" });
  await signIn();
  await expect(page).toHaveURL(/\/wiki\/logistics\/insurance#raw-heading$/);

  for (const redirect of ["https://evil.example/phish", "//evil.example/phish"]) {
    await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`, { waitUntil: "domcontentloaded" });
    await signIn();
    await page.waitForURL(/\/$/, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);
    // WebKit may expose the destination URL before the old document finishes navigating.
    await waitForPageTitle(page, "Diana Wiki Home");
  }
});

// 14 --------------------------------------------------------------------------
test("early reader paints from the HTML response before storage is ready, then navigates, follows live updates and honours revocation", async ({ page }) => {
  const api = await setupEarly(page, false);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?paintDebug=1");
  const article = page.getByTestId("document-article");
  await expect(article).toContainText("EARLY_READER_BODY");
  // Readable before the store handoff exists. (Keeping the article node and an open
  // palette mounted through the handoff is red/flaky on main; see the report.)
  expect(await handoffCount(page)).toBe(0);
  await releaseStorage(page);
  await expect.poll(() => handoffCount(page)).toBeGreaterThan(0);
  await article.getByRole("link", { name: "Insurance", exact: true }).click();
  await expect(article).toContainText("Prior authorization");
  await page.goBack();
  await expect(article).toContainText("EARLY_READER_BODY");
  api.setPageOverride("index", { content: "# Changed\n\nLIVE_UPDATE" });
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
  await expect(article).toContainText("LIVE_UPDATE");
  // A page that becomes sensitive for a public reader is removed, not kept.
  api.setPageOverride("index", { sensitive: true });
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
  await expect(article).not.toContainText("LIVE_UPDATE");
  await expect(article).not.toContainText("EARLY_READER_BODY");
  expect(errors).toEqual([]);
});
