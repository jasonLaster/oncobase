import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";
import { injectPageBootstrap } from "../server/page-bootstrap";

const content = "# Bootstrap fixture\n\nCSR_DATA_BODY\n\n[Insurance](/wiki/logistics/insurance)";
const record = { slug: "index", title: "Bootstrap fixture", content, sensitive: false, tags: [],
  contentHash: createHash("sha256").update(`index:${content}`).digest("hex").slice(0, 24) };
for (const sessionAuthenticated of [false, true]) {
  test(`CSR seeds data without a body request; session=${sessionAuthenticated}`, async ({ page }) => {
    const api = await installWikiApiMocks(page, { sessionAuthenticated, pageOverrides: { index: record } });
    const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
      await route.fulfill({ contentType: "text/html", body: injectPageBootstrap(template, record, url, "diana") });
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length)).toBe(1);
    expect(api.pages.filter(value => new URL(value).searchParams.get("slugs")?.split(",").includes("index"))).toHaveLength(0);
    await expect(page.locator("#wiki-html-first, #wiki-page-bootstrap")).toHaveCount(0);
    await page.getByTestId("document-article").getByRole("link", { name: "Insurance", exact: true }).click();
    await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
    await page.goBack();
    await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
    api.setPageOverride("index", { content: "# Revised\n\nUPDATED_BODY" });
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(page.getByTestId("document-article")).toContainText("UPDATED_BODY");
    api.setPageOverride("index", { sensitive: true });
    if (!sessionAuthenticated) {
      await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
      await expect(page.getByTestId("document-article")).not.toContainText("UPDATED_BODY");
    }
    expect(errors).toEqual([]);
  });
}

test("an invalid CSR payload falls back to the body API", async ({ page }) => {
  const api = await installWikiApiMocks(page, { pageOverrides: { index: record } });
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document") return route.fallback();
    await route.fulfill({ contentType: "text/html", body: injectPageBootstrap(template, record, url, "wrong-site") });
  });
  await page.goto("/");
  await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
  expect(api.pages.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length)).toBe(0);
});

test("a public identity refresh preserves the article and does not restart its store", async ({ page, browserName }) => {
  await installWikiApiMocks(page, { pageOverrides: { index: record } });
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
    await route.fulfill({ contentType: "text/html", body: injectPageBootstrap(template, record, url, "diana") });
  });
  // Reproduce the slow-CPU restart race in Chromium; WebKit exercises the
  // same identity handoff without a Chromium-only emulation dependency.
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?scope=public");
  await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
  await expect(page.getByTestId("sidebar-search")).toBeVisible();

  let releaseIdentity!: () => void;
  const identityGate = new Promise<void>(resolve => { releaseIdentity = resolve; });
  await page.route("**/api/wiki/session**", async route => {
    await identityGate;
    await route.fallback();
  });
  try {
    await page.reload();
    await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
    const article = await page.getByTestId("document-article").elementHandle();
    if (!article) throw new Error("Missing initial article");
    const bootCount = () => page.evaluate(() => performance.getEntriesByName("livestore:makeAdapter:start").length);
    await expect.poll(bootCount).toBe(1);
    const identityResponse = page.waitForResponse(response => response.url().includes("/api/wiki/session"));
    releaseIdentity();
    await (await identityResponse).finished();
    // Check over the handoff, not just the first frame. The old callback
    // restarted the provider here and sometimes hit its 3-second watchdog.
    for (let frame = 0; frame < 75; frame++) {
      expect(await article.evaluate(node => node.isConnected && getComputedStyle(node).visibility !== "hidden")).toBe(true);
      expect(await bootCount()).toBe(1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    await page.getByTestId("document-article").getByRole("link", { name: "Insurance", exact: true }).click();
    await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
    await page.goBack();
    await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
    await page.getByTestId("sidebar-search").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    releaseIdentity();
  }
});

for (const mode of [
  { query: "?scope=public", verified: false, early: true, opensStore: true },
  { query: "", verified: true, early: true, opensStore: true },
  { query: "", verified: false, early: true, opensStore: false },
  { query: "?readerSessionPreview=0", verified: false, early: false, opensStore: false },
  { query: "?scope=session", verified: true, early: false, opensStore: false },
]) {
  test(`cold response identity: query=${mode.query}; verified=${mode.verified}`, async ({ page }) => {
    const api = await installWikiApiMocks(page, { sessionAuthenticated: mode.query === "?scope=session", pageOverrides: { index: record } });
    const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (route.request().resourceType() !== "document") return route.fallback();
      await route.fulfill({ contentType: "text/html", headers: { "Cache-Control": "private, no-store" },
        body: injectPageBootstrap(template, record, url, "diana", { publicSessionVerified: mode.verified }) });
    });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let pending = false;
    await page.route("**/api/wiki/session**", async route => { pending = true; await held; await route.fallback(); });
    try {
      await page.goto(`/${mode.query}`, { waitUntil: "domcontentloaded" });
      await expect.poll(() => pending).toBe(true);
      if (mode.early) {
        await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
        await expect.poll(() => page.evaluate(() => performance.getEntriesByName("livestore:makeAdapter:start").length)).toBe(mode.opensStore ? 1 : 0);
      } else {
        await expect(page.getByTestId("app-starting")).toBeVisible();
        await expect(page.getByTestId("document-article")).toHaveCount(0);
      }
      release();
      await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
      expect(api.pages).toHaveLength(0);
    } finally { release(); }
  });
}
