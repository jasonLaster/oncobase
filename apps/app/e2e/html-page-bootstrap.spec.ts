import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { installWikiApiMocks } from "./fixtures";
import { injectHtmlFirstPage } from "../server/html-first-experiment";
import { applyPiiRedactions } from "@oncobase/wiki-content/pii";

const content = applyPiiRedactions("BOOTSTRAPPED_HOME. Ready to read.\n\n[Insurance](/wiki/logistics/insurance)\n\n## Details\n\n" + "A reading paragraph with space to scroll.\n\n".repeat(60));
const publicPage = { slug: "index", title: "Home", content, tags: [], sensitive: false,
  contentHash: createHash("sha256").update(`index:${content}`).digest("hex").slice(0, 24) };

async function prepare(page: Page, mutate?: (html: string) => string, sessionAuthenticated = false) {
  const api = await installWikiApiMocks(page, { sessionAuthenticated,
    pageOverrides: { index: { content, title: "Home", tags: [] } } });
  // Exercise the real server renderer/boot script and production JS graph, but
  // use synthetic documents and API fixtures throughout this test.
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const criticalCss = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
    let html = injectHtmlFirstPage(template, publicPage, url, "diana", criticalCss);
    if (mutate) html = mutate(html);
    await route.fulfill({ contentType: "text/html", headers: { "Cache-Control": "private, no-store" }, body: html });
  });
  return api;
}
const article = (page: Page) => page.locator('#root [data-test-id="document-article"]');
const homeFetches = (urls: string[]) => urls.filter(url => new URL(url).searchParams.get("slugs")?.split(",").includes("index"));

test("inline article styles allow reading before the application stylesheet arrives", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route("**/*.css", async route => { await held; await route.continue(); });
  try {
    await page.goto("/", { waitUntil: "commit" });
    const early = page.locator("#wiki-html-first .wiki-markdown");
    await expect(early).toBeVisible();
    expect(await early.locator("p").first().evaluate(node => parseFloat(getComputedStyle(node).lineHeight))).toBeCloseTo(27.2, 2);
    const before = await early.boundingBox();
    await expect(article(page)).toBeAttached();
    await expect(page.locator("#wiki-html-first")).toBeVisible();
    release();
    await expect(article(page)).toBeVisible();
    const after = await article(page).locator(".wiki-markdown").boundingBox();
    expect(Math.abs(before!.x - after!.x)).toBeLessThan(2);
    expect(Math.abs(before!.width - after!.width)).toBeLessThan(2);
  } finally { release(); }
});

test("HTML stays readable while scripts are held; payload seeds before consumers without a body fetch", async ({ page }) => {
  const api = await prepare(page);
  let release!: () => void;
  let releaseManifest!: () => void;
  const held = new Promise<void>(r => { release = r; });
  const manifest = new Promise<void>(r => { releaseManifest = r; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    if (new URL(route.request().url()).pathname === "/api/wiki/manifest") await manifest;
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("#wiki-html-first article")).toContainText("BOOTSTRAPPED_HOME");
    await expect(page.locator("#root")).toHaveCSS("visibility", "hidden");
    release();
    await expect(article(page)).toBeVisible();
    await expect(article(page)).toContainText("BOOTSTRAPPED_HOME");
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await expect(page.locator("#wiki-page-bootstrap")).toHaveCount(0);
    expect(homeFetches(api.pages)).toHaveLength(0);
    expect(await page.evaluate(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length)).toBe(1);
    releaseManifest();
    await expect.poll(() => api.manifest.length).toBeGreaterThan(0);
    await expect(page.locator('#root [data-test-id="wiki-sidebar"]')).toContainText("logistics");
    expect(homeFetches(api.pages)).toHaveLength(0);
  } finally { release(); releaseManifest(); }
});

test("fresh manifest updates replace the bootstrap; a later restriction removes its public body", async ({ page }) => {
  const api = await prepare(page);
  api.setManifestDelay(1200);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toContainText("BOOTSTRAPPED_HOME");
  api.setPageOverride("index", { content: "UPDATED_BODY_FROM_API" });
  await expect(article(page)).toContainText("UPDATED_BODY_FROM_API");
  expect(homeFetches(api.pages)).toHaveLength(1);
  api.setManifestDelay(0);
  api.setPageOverride("index", { sensitive: true });
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
  await expect(article(page)).not.toContainText("UPDATED_BODY_FROM_API");
  await expect(article(page)).toContainText(/no longer available|restricted|private/i);
  await expect(page.locator("#wiki-html-first")).toHaveCount(0);
});

test("a restriction arriving during a text selection dismisses the early public representation", async ({ page }) => {
  const api = await prepare(page);
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("#wiki-html-first article")).toBeVisible();
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#wiki-html-first article p")!);
      window.getSelection()!.addRange(range);
    });
    api.setPageOverride("index", { sensitive: true });
    release();
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await expect(article(page)).not.toContainText("BOOTSTRAPPED_HOME");
    await expect(article(page)).toContainText(/no longer available|restricted|private/i);
  } finally { release(); }
});

test("a restriction dismisses early HTML even when a large article omits its startup payload", async ({ page }) => {
  const api = await prepare(page, html => html.replace(/<script id="wiki-page-bootstrap"[\s\S]*?<\/script>/, ""));
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("#wiki-html-first article")).toBeVisible();
    api.setPageOverride("index", { sensitive: true });
    release();
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await expect(article(page)).toContainText(/no longer available|restricted|private/i);
  } finally { release(); }
});

test("invalid bootstrap falls back to the scoped page API", async ({ page }) => {
  const api = await prepare(page, html => html.replace('"siteSlug":"diana"', '"siteSlug":"other"'));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible();
  await expect(article(page)).toContainText("BOOTSTRAPPED_HOME");
  expect(homeFetches(api.pages)).toHaveLength(1);
  expect(await page.evaluate(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length)).toBe(0);
});

test("public bootstrap does not decide the account identity or populate a public snapshot from a session reader", async ({ page }) => {
  const api = await prepare(page, undefined, true);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible();
  await expect.poll(() => api.manifest.length).toBeGreaterThan(0);
  expect(api.manifest.every(url => new URL(url).searchParams.get("scope") === "session")).toBe(true);
  expect(homeFetches(api.pages)).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:first-frame:")))).toBe(false);
});
