import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

const body = "# Cached reader\n\nCACHED_BODY\n\n" + "Stable paragraph for selection and scroll.\n\n".repeat(80);
const query = "?paintDebug=1&readerStorage=memory";
async function setup(page: Page, privatePage = false) {
  const api = await installWikiApiMocks(page, { sessionAuthenticated: true, pageOverrides: { index: { content: body, sensitive: privatePage } } });
  let accountTag = "account-a";
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html.replace("</head>", `<meta name="wiki-reader-account" content="${accountTag}" /></head>`) }) : route.fallback());
  return { ...api, setHtmlAccount: (tag: string) => { accountTag = tag; } };
}
async function waitForCache(page: Page, text = "CACHED_BODY") {
  await expect.poll(() => page.evaluate(text => Object.keys(localStorage).some(key =>
    key.startsWith("wiki-vite:startup:") && localStorage.getItem(key)?.includes(text)), text)).toBe(true);
}
async function holdIdentity(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/session**", async route => { await gate; await route.fallback(); });
  return release;
}

for (const privatePage of [false, true]) {
  test(`cached page and file tree paint before identity; private=${privatePage}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await setup(page, privatePage);
    await page.goto(`/${query}`);
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
}

test("a vault larger than the storage bound restores from its compressed snapshot", async ({ page }) => {
  const api = await setup(page);
  api.setPageOverride("index", { description: "Synthetic metadata for a large vault. ".repeat(90000) });
  await page.goto(`/${query}`);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key =>
    key.startsWith("wiki-vite:startup:") && localStorage.getItem(key)?.startsWith("gz1:")))).toBe(true);
  const release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    await expect(page.locator('[data-reader-cache-startup]')).toHaveAttribute("data-reader-cache-startup", "true");
    await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "false");
    release();
    await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "true");
  } finally { release(); }
});

test("new markdown and file tree replace stale data without resetting scroll or navigation", async ({ page }) => {
  const api = await setup(page);
  await page.goto(`/${query}`); await waitForCache(page);
  api.setPageOverride("index", { content: body + "\n\nUPDATED_BODY" });
  api.setPageOverride("wiki/cache-added-page", { title: "Added page", content: "# Added page", tags: [] });
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
    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette").locator("input").fill("cache-added-page");
    await expect(page.getByTestId("command-palette")).toContainText("cache added page");
    await waitForCache(page, "UPDATED_BODY");
  } finally { release(); }
});

test("a changed identity discards the previous account before its store opens", async ({ page }) => {
  const api = await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
  api.setSessionCacheKey("different-account-key", "different-user");
  api.setPageOverride("index", { content: "# New account\n\nOTHER_ACCOUNT_BODY" });
  const release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    release();
    await expect(page.getByTestId("document-article")).toContainText("OTHER_ACCOUNT_BODY");
    await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
    await waitForCache(page, "OTHER_ACCOUNT_BODY");
    expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:startup:") && localStorage.getItem(key)?.includes("CACHED_BODY")))).toBe(false);
  } finally { release(); }
});

test("HTML identifying another account prevents the old private cache from painting", async ({ page }) => {
  const api = await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
  api.setSessionCacheKey("account-b", "user-b");
  api.setHtmlAccount("account-b");
  api.setPageOverride("index", { content: "# B\n\nACCOUNT_B_BODY" });
  const release = await holdIdentity(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reader-pending")).toBeVisible();
    await expect(page.getByTestId("document-article")).toHaveCount(0);
    release();
    await expect(page.getByTestId("document-article")).toContainText("ACCOUNT_B_BODY");
    await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
  } finally { release(); }
});

test("confirmed session denial removes the cached body and tree", async ({ page }) => {
  await setup(page, true);
  await page.goto(`/${query}&scope=session`); await waitForCache(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/session**", async route => { await gate; await route.fulfill({ status: 401, json: { error: "Session expired" } }); });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    release();
    await expect(page.getByTestId("session-recovery")).toBeVisible();
    await expect(page.getByTestId("document-article")).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:startup:")))).toBe(false);
  } finally { release(); }
});

test("a transient identity outage retains remembered content and cached navigation", async ({ page }) => {
  const api = await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
  api.setSessionIdentityFailure(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
  await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "false");
  await expect(page.getByTestId("session-recovery")).toHaveCount(0);
  await page.getByTestId("sidebar-search").click();
  await page.getByTestId("command-palette").locator("input").fill("Insurance");
  await expect(page.getByTestId("command-palette")).toContainText(/insurance/i);
});

test("a fresh page denial clears remembered access even when its content hash was unchanged", async ({ page }) => {
  const api = await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
  api.setPageFailure("index", true);
  await page.route("**/api/wiki/pages**", route => route.fulfill({ status: 403, json: { error: "Access removed" } }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:startup:")))).toBe(false);
});

test("the cache opt-out waits for verification and does not use remembered private content", async ({ page }) => {
  await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
  const release = await holdIdentity(page);
  try {
    await page.goto(`/${query}&readerCache=0`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reader-pending")).toBeVisible();
    await expect(page.getByTestId("document-article")).toHaveCount(0);
    release();
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
  } finally { release(); }
});

test("two cached routes can navigate while identity is still pending", async ({ page }) => {
  await setup(page);
  await page.goto(`/${query}`); await waitForCache(page);
  await page.goto(`/wiki/logistics/insurance${query}`);
  await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("wiki-vite:startup:"));
    return key ? JSON.parse(localStorage.getItem(key)!).bodies.length : 0;
  })).toBe(2);
  const release = await holdIdentity(page);
  try {
    await page.goto(`/${query}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette").locator("input").fill("Insurance");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
    await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "false");
    release();
    await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "true");
    await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
  } finally { release(); }
});

test("sign-out notification invalidates remembered private content and fences old writers", async ({ page }) => {
  const api = await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
  api.setSessionAuthenticated(false);
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-auth-session-change")));
  await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:startup:") && localStorage.getItem(key)?.includes("CACHED_BODY")))).toBe(false);
  await page.reload();
  await expect(page.getByTestId("document-article")).not.toContainText("CACHED_BODY");
});

test("an invalidation from another tab removes cached content while identity is held", async ({ page, context }) => {
  await setup(page, true);
  await page.goto(`/${query}`); await waitForCache(page);
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


test("navigation freshness stays honest through refresh, failure and offline", async ({ page, context }) => {
  const api = await setup(page);
  await page.goto(`/${query}`); await waitForCache(page);
  const status = page.getByTestId("wiki-sidebar").getByTestId("navigation-status");
  await expect(status).toHaveAttribute("data-freshness", "current");
  const tree = await page.getByTestId("sidebar-tree").elementHandle();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/manifest**", async route => { await gate; await route.fallback(); });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(status).toHaveAttribute("data-freshness", "checking");
    await expect(status).toContainText("Checking…");
    await expect.poll(() => status.locator(".reader-navigation-status-detail").evaluate(node => getComputedStyle(node).opacity)).toBe("1");
    await page.screenshot({ path: test.info().outputPath("navigation-checking-light.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(status.locator(".reader-status-dot")).toHaveCSS("animation-name", "none");
    release();
    await expect(status).toHaveAttribute("data-freshness", "current");
    expect(await tree!.evaluate(node => node.isConnected)).toBe(true);
    api.setManifestFailure(true);
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(status).toHaveAttribute("data-freshness", "saved");
    await expect(status).toContainText("Saved · retrying");
    await context.setOffline(true);
    await expect(status).toContainText("Saved · offline");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    // The app's theme switch normally owns this class; use it only in this synthetic visual fixture.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.getByTestId("bottom-nav-trigger").click();
    const mobileStatus = page.getByTestId("bottom-nav-page-tree").getByTestId("navigation-status");
    await expect(mobileStatus).toContainText("Saved · offline");
    await expect(mobileStatus).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("navigation-offline-mobile-dark.png"), animations: "disabled" });
    await expect(page.getByTestId("bottom-nav-page-tree").getByRole("button", { name: "Collapse wiki", exact: true })).toBeEnabled();
  } finally { release(); await context.setOffline(false); }
});

test("ready code uses page loading while identity and content wait", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const release = await holdIdentity(page);
  let releaseBody!: () => void;
  const bodyGate = new Promise<void>(resolve => { releaseBody = resolve; });
  await page.route("**/api/wiki/pages**", async route => { await bodyGate; await route.fallback(); });
  try {
    await page.goto(`/${query}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reader-pending")).toBeVisible();
    await expect(page.getByTestId("app-starting")).toHaveCount(0);
    release();
    await expect(page.getByTestId("page-activity")).toHaveText("Loading page…");
    await expect(page.getByTestId("app-starting")).toHaveCount(0);
    await expect(page.getByTestId("page-activity")).toHaveCSS("animation-name", "none");
    await expect(page.locator(".wiki-shell-markdown-body-skeleton > div").first()).toHaveCSS("animation-name", "none");
    await page.screenshot({ path: test.info().outputPath("page-loading-reduced-motion.png") });
  } finally { release(); releaseBody(); }
  await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
});


test("ready JavaScript does not show launch while identity is slow", async ({ page }) => {
  await setup(page);
  await page.goto(`/${query}`); await waitForCache(page);
  const release = await holdIdentity(page);
  await page.addInitScript(() => {
    const visible: number[] = [];
    Object.assign(window, { launchVisibleFrames: visible });
    const observe = () => {
      const node = document.querySelector('[data-test-id="app-starting"]');
      if (node && getComputedStyle(node).visibility === "visible" && !node.closest("[hidden]")) visible.push(performance.now());
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  try {
    // Disable the body cache to distinguish code readiness from data readiness.
    await page.goto(`/${query}&readerCache=0`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reader-pending")).toBeVisible();
    // Stay beyond the cold-script indicator deadline while identity is held.
    await page.waitForTimeout(750);
    await expect(page.getByTestId("app-starting")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { launchVisibleFrames: number[] }).launchVisibleFrames)).toEqual([]);
  } finally { release(); }
  await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
});

test("slow JavaScript gets a delayed launch indicator even with reduced motion", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await gate;
    await route.fallback();
  });
  try {
    await page.goto(`/${query}`, { waitUntil: "commit" });
    const launch = page.getByTestId("app-starting");
    await expect(launch).toBeAttached();
    await expect(launch).toBeHidden();
    await expect(launch).toBeVisible();
    await expect(launch).toContainText("Launching Diana TNBC...");
    await expect(page.locator(".app-startup-mark")).toHaveCSS("animation-name", "none");
  } finally { release(); }
  await expect(page.getByTestId("document-article")).toContainText("CACHED_BODY");
});
