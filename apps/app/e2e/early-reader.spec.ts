import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { buildCompactTreeFromManifest, WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { injectPageBootstrap } from "../server/page-bootstrap";
import { installWikiApiMocks } from "./fixtures";

const content = "# Early reader\n\nEARLY_READER_BODY\n\n[Insurance](/wiki/logistics/insurance)\n\n" + "Stable text for selection and scrolling.\n\n".repeat(80);
const record = { slug: "index", title: "Early reader", content, sensitive: false, tags: [],
  contentHash: createHash("sha256").update(content).digest("hex").slice(0, 24) };

async function setup(page: Page, authenticated: boolean) {
  const api = await installWikiApiMocks(page, { sessionAuthenticated: authenticated, pageOverrides: { index: record } });
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
    const tree = buildCompactTreeFromManifest(["index", "wiki/logistics/insurance"].map(slug => ({
      slug, title: slug === "index" ? "Early reader" : "Insurance", description: null,
      contentHash: "fixture", tags: [], sensitive: false, size: 1,
    })), []);
    const navigation = JSON.stringify({ version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
      origin: url.origin, pathname: url.pathname, siteSlug: "diana", scope: "public", tree });
    const html = injectPageBootstrap(template, record, url, "diana").replace("</body>",
      `<script id="wiki-navigation-bootstrap" type="application/json">${navigation}</script><script>document.getElementById('wiki-navigation-bootstrap').dataset.receivedAt=String(Date.now())</script></body>`);
    await route.fulfill({ contentType: "text/html", body: html });
  });
  // Pause only this synthetic context's storage probe. The real adapter and
  // database start once released (or use their normal unavailable fallback).
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

for (const authenticated of [false, true]) {
  test(`early reader keeps article and search mounted through live handoff; session=${authenticated}`, async ({ page }) => {
    const api = await setup(page, authenticated);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/?paintDebug=1");
    const article = page.getByTestId("document-article");
    await expect(article).toContainText("EARLY_READER_BODY");
    expect(await handoffCount(page)).toBe(0);
    const handle = await article.elementHandle();
    await page.getByTestId("sidebar-search").click();
    const search = page.getByTestId("command-palette").locator("input");
    await search.fill("Insurance");
    await expect(page.getByTestId("command-palette")).toContainText(/insurance/i);
    const input = await search.elementHandle();
    await releaseStorage(page);
    await expect.poll(() => handoffCount(page)).toBeGreaterThan(0);
    expect(await handle!.evaluate(node => node.isConnected)).toBe(true);
    expect(await input!.evaluate(node => node.isConnected && node === document.activeElement)).toBe(true);
    await expect(search).toHaveValue("Insurance");
    await page.keyboard.press("Escape");
    await article.getByRole("link", { name: "Insurance", exact: true }).click();
    await expect(article).toContainText("Prior authorization");
    await page.goBack();
    await expect(article).toContainText("EARLY_READER_BODY");
    api.setPageOverride("index", { content: "# Changed\n\nLIVE_UPDATE" });
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(article).toContainText("LIVE_UPDATE");
    if (!authenticated) {
      api.setPageOverride("index", { sensitive: true });
      await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
      await expect(article).not.toContainText("LIVE_UPDATE");
      await expect(article).not.toContainText("EARLY_READER_BODY");
    }
    expect(errors).toEqual([]);
  });
}

test("navigation requested before storage is ready retains the article then loads the requested page", async ({ page }) => {
  await setup(page, true);
  await page.goto("/?paintDebug=1&readerBootstrap=1");
  const article = page.getByTestId("document-article");
  await expect(article).toContainText("EARLY_READER_BODY");
  await article.getByRole("link", { name: "Insurance", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/logistics\/insurance/);
  await expect(article).toContainText("EARLY_READER_BODY");
  await releaseStorage(page);
  await expect(article).toContainText("Prior authorization");
});

test("selection and scroll survive the initial-to-live transition", async ({ page }) => {
  await setup(page, true);
  await page.goto("/?paintDebug=1&readerBootstrap=1");
  const paragraph = page.getByTestId("document-article").locator("p").filter({ hasText: "Stable text for selection" }).first();
  await expect(paragraph).toBeVisible();
  expect(await handoffCount(page)).toBe(0);
  const node = await paragraph.elementHandle();
  const scrollBefore = await paragraph.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    let scroll: Element | null = element;
    while (scroll && !(scroll.scrollHeight > scroll.clientHeight && /auto|scroll/.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement;
    const container = scroll ?? document.scrollingElement!;
    container.scrollTop = 300;
    Object.assign(window, { readerScrollContainer: container });
    return container.scrollTop;
  });
  expect(scrollBefore).toBeGreaterThan(0);
  await releaseStorage(page);
  await expect.poll(() => handoffCount(page)).toBeGreaterThan(0);
  expect(await node!.evaluate(element => element.isConnected)).toBe(true);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Stable text for selection and scrolling.");
  expect(await page.evaluate(() => (window as unknown as { readerScrollContainer: Element }).readerScrollContainer.scrollTop)).toBe(scrollBefore);
});

test("the initial public response cannot bypass required session verification", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/wiki/session**", route => route.fulfill({ status: 401, json: { error: "Session unavailable" } }));
  await page.goto("/?scope=session&paintDebug=1&readerBootstrap=1");
  await expect(page.getByTestId("session-recovery")).toBeVisible();
  await expect(page.getByTestId("document-article")).toHaveCount(0);
  expect(await handoffCount(page)).toBe(0);
});

test("the comparison opt-out retains provider-gated rendering", async ({ page }) => {
  await setup(page, true);
  await page.goto("/?paintDebug=1&readerBootstrap=0");
  await expect(page.getByTestId("app-starting")).toBeVisible();
  await expect(page.getByTestId("document-article")).toHaveCount(0);
  await releaseStorage(page);
  await expect(page.getByTestId("document-article")).toContainText("EARLY_READER_BODY");
  await expect(page.locator("[data-reader-store-ready]")).toHaveAttribute("data-reader-store-ready", "true");
  expect(await handoffCount(page)).toBe(0);
});

test("a worker creation failure falls back without inserting a launching screen over the article", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Exercise the persisted worker path; WebKit storage fallback is covered separately");
  await setup(page, true);
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    let attempts = 0;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        // The adapter attempts both function and constructor invocation.
        if (String(url).includes("livestore.worker") && attempts++ < 2) throw new Error("Fixture transient worker creation failure");
        super(url, options);
      }
    };
  });
  const fallbacks: string[] = [];
  page.on("console", message => { if (message.text().includes("Reader startup timed out; using temporary storage")) fallbacks.push(message.text()); });
  await page.goto("/?paintDebug=1");
  const article = page.getByTestId("document-article");
  await expect(article).toContainText("EARLY_READER_BODY");
  const handle = await article.elementHandle();
  await releaseStorage(page);
  await expect.poll(() => fallbacks.length).toBeGreaterThan(0);
  expect(await page.getByTestId("app-starting").isVisible()).toBe(false);
  await expect.poll(() => handoffCount(page)).toBeGreaterThan(0);
  expect(await handle!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator("[data-reader-store-ready]")).toHaveAttribute("data-reader-store-ready", "true");
});

test("a real store shutdown shows one recovery screen and never revives the initial body", async ({ page }) => {
  await setup(page, true);
  await page.goto("/?paintDebug=1");
  await expect(page.getByTestId("document-article")).toContainText("EARLY_READER_BODY");
  await releaseStorage(page);
  await expect.poll(() => handoffCount(page)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const store = (window as unknown as { __debugLiveStore: { _: { shutdown: () => Promise<void> } } }).__debugLiveStore._;
    await store.shutdown();
  });
  await expect(page.getByTestId("store-startup-recovery")).toHaveCount(1);
  await expect(page.getByTestId("store-startup-recovery")).toBeVisible();
  await expect(page.getByTestId("document-article")).toHaveCount(0);
});

test("a failed boot callback retries without moving the already readable article", async ({ page }) => {
  await setup(page, true);
  const retries: string[] = [];
  page.on("console", message => { if (message.text().includes("LiveStore boot failed; retrying once")) retries.push(message.text()); });
  await page.goto("/?paintDebug=1");
  const article = page.getByTestId("document-article");
  await expect(article).toContainText("EARLY_READER_BODY");
  const handle = await article.elementHandle();
  // Fail the real boot callback once, after presentation accepted the data.
  // Leave its response node intact so the normal retry can consume it.
  await page.evaluate(() => {
    const remove = Element.prototype.remove;
    let failed = false;
    Element.prototype.remove = function () {
      if (!failed && this.id === "wiki-page-bootstrap") {
        failed = true;
        throw new Error("Fixture transient bootstrap consumption failure");
      }
      return remove.call(this);
    };
  });
  await releaseStorage(page);
  await expect.poll(() => retries.length).toBeGreaterThan(0);
  expect(await page.getByTestId("app-starting").isVisible()).toBe(false);
  await expect.poll(() => handoffCount(page)).toBeGreaterThan(0);
  expect(await handle!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator("[data-reader-store-ready]")).toHaveAttribute("data-reader-store-ready", "true");
});
