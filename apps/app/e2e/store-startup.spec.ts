import { expect, test, type Page } from "@playwright/test";
import { makePublicWikiSessionIdentity, makeWikiStoreId } from "@oncobase/wiki-content";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

async function ready(page: Page) {
  await expect(page.locator('#root [data-test-id="document-article"]')).toContainText("Prior authorization", { timeout: 25_000 });
  await expect(page.getByTestId("sidebar-search")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-wiki-first-frame", "true");
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
  await page.goto("/wiki/logistics/insurance");
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
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await ready(page);
});

test("healthy follower tabs and leader handoff do not need fallback", async ({ page, context }) => {
  test.setTimeout(60_000);
  const warnings: string[] = [];
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  const copiedSession = await page.evaluate(() => ({ ...sessionStorage }));
  const follower = await context.newPage();
  // Model Duplicate Tab / window.open copying sessionStorage from its opener.
  await follower.addInitScript(values => {
    for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value);
  }, copiedSession);
  follower.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await installWikiApiMocks(follower);
  await gotoWiki(follower, "/wiki/logistics/insurance");
  await page.close();
  await follower.reload();
  await ready(follower);
  // Exercise fast reload and former leader shutdown overlap repeatedly.
  for (let index = 0; index < 3; index++) {
    await follower.reload({ waitUntil: "domcontentloaded" });
  }
  await ready(follower);
  await follower.clock.fastForward(16_000);
  await ready(follower);
  expect(warnings.filter(message => message.includes("startup timed out"))).toEqual([]);
});

test("a silent shared worker recovers on a cached client reload", async ({ page }) => {
  test.setTimeout(60_000);
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  await page.addInitScript(() => {
    const RealSharedWorker = window.SharedWorker;
    const silent = URL.createObjectURL(new Blob(["onconnect = () => {};"], { type: "text/javascript" }));
    window.SharedWorker = class extends RealSharedWorker {
      constructor(url: string | URL, options?: string | WorkerOptions) {
        super(silent, options);
      }
    };
  });
  await page.reload();
  await ready(page);
  await expect(page.getByTestId("store-startup-recovery")).toHaveCount(0);
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

test("a stalled temporary store ends in visible recovery instead of a reload loop", async ({ page }) => {
  test.setTimeout(60_000);
  await installWikiApiMocks(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
  });
  await page.route("**/*.wasm*", () => {});
  await page.goto("/wiki/logistics/insurance");
  await expect(page.getByTestId("store-startup-recovery")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("startup-recovery.png") });
});

test("leaving during startup cancels recovery timers", async ({ page }) => {
  test.setTimeout(45_000);
  await installWikiApiMocks(page);
  await page.route("**/*.wasm*", () => {});
  await page.goto("/wiki/logistics/insurance");
  await expect(page.getByTestId("page-loading").first()).toBeVisible();
  await page.goto("/terms-and-conditions");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.clock.fastForward(35_000);
  await expect(page.getByTestId("store-startup-recovery")).toHaveCount(0);
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
});

test("a new worker version cannot strand a tab behind the old version's leader", async ({ page, context }) => {
  test.setTimeout(60_000);
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
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
  await newer.goto("/wiki/logistics/insurance");
  await ready(newer);
  expect(warnings.some(message => message.includes("startup timed out"))).toBe(true);
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

test("duplicated legacy session storage does not duplicate live session IDs", async ({ page, context, baseURL }) => {
  const identity = makePublicWikiSessionIdentity("diana");
  const storeId = makeWikiStoreId({ siteSlug: "diana", scope: "public", origin: new URL(baseURL!).origin, cacheKey: identity.cacheKey });
  await context.addInitScript(key => sessionStorage.setItem(key, "duplicated-legacy-id"), `livestore:sessionId:${storeId}`);
  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  const other = await context.newPage();
  await installWikiApiMocks(other);
  await gotoWiki(other, "/wiki/logistics/insurance");
  const sessionId = (target: Page) => target.evaluate(() => {
    const debug = (window as unknown as { __debugLiveStore: Record<string, { sessionId: string }> }).__debugLiveStore;
    return debug._.sessionId;
  });
  const first = await sessionId(page);
  const second = await sessionId(other);
  expect(first).not.toBe("duplicated-legacy-id");
  expect(second).not.toBe(first);
});
