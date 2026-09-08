import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { installWikiApiMocks } from "./fixtures";
import { injectHtmlFirstPage } from "../server/html-first-experiment";
import { renderReaderNavigation } from "../server/reader-navigation";
import { buildFileTreeFromManifest } from "@oncobase/wiki-content";
import { applyPiiRedactions } from "@oncobase/wiki-content/pii";

const content = applyPiiRedactions("BOOTSTRAPPED_HOME. Ready to read.\n\n[Insurance](/wiki/logistics/insurance)\n\n## Details\n\n" + "A reading paragraph with space to scroll.\n\n".repeat(60));
const publicPage = { slug: "index", title: "Home", content, tags: [], sensitive: false,
  contentHash: createHash("sha256").update(`index:${content}`).digest("hex").slice(0, 24) };

async function prepare(page: Page, mutate?: (html: string) => string, sessionAuthenticated = false, sourceContent = content) {
  const responseContent = applyPiiRedactions(sourceContent);
  const responsePage = { ...publicPage, content: responseContent,
    contentHash: createHash("sha256").update(`index:${responseContent}`).digest("hex").slice(0, 24) };
  const api = await installWikiApiMocks(page, { sessionAuthenticated,
    pageOverrides: { index: { content: sourceContent, title: "Home", tags: [] } } });
  // Exercise the real server renderer/boot script and production JS graph, but
  // use synthetic documents and API fixtures throughout this test.
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const criticalCss = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
    const tree = buildFileTreeFromManifest([{slug:"index"}, {slug:"wiki/logistics/insurance"}]);
    let html = injectHtmlFirstPage(template, responsePage, url, "diana", criticalCss, renderReaderNavigation(tree, "index"), tree);
    if (mutate) html = mutate(html);
    await route.fulfill({ contentType: "text/html", headers: { "Cache-Control": "private, no-store" }, body: html });
  });
  return api;
}
const article = (page: Page) => page.locator('#root [data-test-id="document-article"]');
const homeFetches = (urls: string[]) => urls.filter(url => new URL(url).searchParams.get("slugs")?.split(",").includes("index"));

test("a late section stays readable as a long article hands off to interactive layout", async ({ page }) => {
  await prepare(page, undefined, false, "Opening paragraph.\n\n" +
    ("Complete paragraph. " + "Long article content. ".repeat(16) + "\n\n").repeat(600) +
    "## Last section\n\nThe complete final paragraph.");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto("/#last-section", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#wiki-html-first-rest")).toHaveCount(0);
    const early = page.locator("#wiki-html-last-section");
    await expect(early).toBeInViewport();
    release();
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await expect(article(page).locator("#last-section")).toBeInViewport();
    await expect(article(page).getByText("The complete final paragraph.", { exact: true })).toBeInViewport();
  } finally { release(); }
});

test("inline article styles allow reading before the application stylesheet arrives", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    if (route.request().resourceType() === "stylesheet") return route.abort();
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    const early = page.locator("#wiki-html-first .wiki-markdown");
    await expect(early).toBeVisible();
    expect(await early.locator("p").first().evaluate(node => parseFloat(getComputedStyle(node).lineHeight))).toBeCloseTo(27.2, 2);
    const before = await early.boundingBox();
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
    // The sidebar must be useful at handoff, even if the manifest never arrives.
    const sidebar = page.locator('#root [data-test-id="wiki-sidebar"]');
    await expect(sidebar).toContainText("logistics");
    await sidebar.getByRole("button", { name: "logistics" }).click();
    await expect(sidebar.locator('a[href="/wiki/logistics/insurance"]')).toBeVisible();
    releaseManifest();
    await expect.poll(() => api.manifest.length).toBeGreaterThan(0);
    await expect(page.locator('#root [data-test-id="wiki-sidebar"]')).toContainText("logistics");
    expect(homeFetches(api.pages)).toHaveLength(0);
  } finally { release(); releaseManifest(); }
});

test("server HTML avoids cloning another full DOM snapshot after handoff", async ({ page }) => {
  await prepare(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible();
  await expect(page.locator("#wiki-html-first")).toHaveCount(0);
  // Cover the former 100 ms capture timer and its asynchronous module load.
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => ({
    captureModules: performance.getEntriesByType("resource").filter(entry => entry.name.includes("snapshot-html-")).length,
    snapshots: Object.keys(localStorage).filter(key => key.startsWith("wiki-vite:first-frame:")).length,
  }));
  expect(saved).toEqual({ captureModules: 0, snapshots: 0 });
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

test("a departing reader defers a late manifest and resumes if navigation is canceled", async ({ page }) => {
  const api = await prepare(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible();
  await expect(page.locator('#root [data-test-id="wiki-sidebar"]')).toContainText("logistics");
  const requestsBefore = api.manifest.length;
  api.setManifestDelay(50);
  api.setPageOverride("index", { content: "RESUMED_AFTER_CANCELED_NAVIGATION" });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("beforeunload"));
    window.dispatchEvent(new Event("wiki-vite:refresh-manifest"));
  });
  await expect.poll(() => api.manifest.length).toBeGreaterThan(requestsBefore);
  await page.waitForTimeout(200);
  await expect(article(page)).toContainText("BOOTSTRAPPED_HOME");
  await expect(article(page)).toContainText("RESUMED_AFTER_CANCELED_NAVIGATION");
  expect(api.manifest.length).toBeGreaterThan(requestsBefore + 1);
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


test("a newer API body hands off even when the initial HTML has no usable bootstrap", async ({ page }) => {
  const api = await prepare(page, html => html.replace(/<script id="wiki-page-bootstrap"[\s\S]*?<\/script>/, ""));
  api.setPageOverride("index", { content: "NEWER_PUBLIC_BODY" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible();
  await expect(article(page)).toContainText("NEWER_PUBLIC_BODY");
  await expect(page.locator("#wiki-html-first")).toHaveCount(0);
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

test("HTML-first startup does not wait for a silent persistent worker", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    window.SharedWorker = class { constructor() { throw new Error("Persistent worker must not block HTML-first startup"); } } as unknown as typeof SharedWorker;
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible({ timeout: 8000 });
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

test("session recovery replaces the HTML overlay and exposes working actions", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/wiki/session*", route => route.fulfill({ status: 503, json: { error: "Synthetic session failure" } }));
  await page.goto("/?scope=session", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("session-recovery")).toBeVisible();
  await expect(page.locator("#wiki-html-first")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue public" })).toBeEnabled();
});


test("native folder selection remains expanded after interactive handoff", async ({ page }) => {
  await prepare(page);
  await page.goto("/?tree=wiki/logistics", { waitUntil: "domcontentloaded" });
  await expect(article(page)).toBeVisible();
  await expect(page.getByTestId("wiki-sidebar").getByRole("button", { name: "Collapse logistics", exact: true })).toBeVisible();
});


for (const asset of ["entry module"]) test(`a missing ${asset} retries once and leaves readable HTML with a manual recovery action`, async ({ page }) => {
  await prepare(page);
  let navigations = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  await page.route(/\/index-[^/]+\.js/, route => route.abort());
  await page.goto("/", {waitUntil:"domcontentloaded"});
  await expect(page.locator('[data-reader-load-error]')).toBeVisible();
  await expect(page.locator('[data-reader-load-error] a')).toHaveText("Reload");
  await expect(page.locator('#wiki-html-first article')).toContainText("BOOTSTRAPPED_HOME");
  expect(navigations).toBe(2);
});

for (const viewport of [{width:1280,height:900}, {width:390,height:844}]) test(`initial article keeps full styling at ${viewport.width}px with CSS and scripts held`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await prepare(page, undefined, false, "## Styled section\n\n[Link](/wiki/logistics/insurance) with **bold** and `code`.\n\n- First item\n- Second item\n\n> Quoted text\n\n<div class=\"flex gap-4 rounded-lg border p-4 bg-muted\"><span>Utility layout</span><span>Second column</span></div>");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (["script", "stylesheet"].includes(route.request().resourceType())) await held;
    await route.fallback();
  });
  const styles = () => page.locator('#wiki-html-first .wiki-markdown').evaluate(root => {
    const selectors = ["h2", "p", "a", "strong", "code", "ul", "li", "blockquote", ".flex"];
    const properties = ["color", "background-color", "display", "font-size", "font-weight", "line-height", "margin-bottom", "padding-left", "border-bottom-width", "border-radius", "gap", "text-decoration-line"];
    return selectors.map(selector => {
      const node = root.querySelector(selector)!;
      const style = getComputedStyle(node);
      return properties.map(property => style.getPropertyValue(property));
    });
  });
  try {
    await page.goto("/", {waitUntil:"commit"});
    await expect(page.locator('#wiki-html-first .flex')).toHaveCSS("display", "flex");
    const initial = await styles();
    // Apply the exact linked CSS while keeping the native DOM in place. This
    // catches missing dependencies independently of React markup differences.
    await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[data-wiki-inlined-style]')!;
      const response = await fetch(link.dataset.wikiStyleSource!);
      const style = document.createElement('style'); style.textContent = await response.text(); document.head.append(style);
      document.getElementById('wiki-critical-style')!.remove();
    });
    expect(await styles()).toEqual(initial);
    await page.screenshot({path:`/tmp/reader-styles-${viewport.width}.png`});
    release();
    await expect(article(page)).toBeVisible();
  } finally { release(); }
});

test("the interactive reader retains its inline styles and needs no stylesheet download", async ({page}) => {
  await prepare(page);
  const requests: string[] = [];
  page.on("request", request => { if (request.resourceType() === "stylesheet") requests.push(request.url()); });
  await page.route(/\.css(?:\?|$)/, route => route.abort());
  await page.goto("/", {waitUntil:"domcontentloaded"});
  await expect(article(page)).toBeVisible();
  await expect(article(page).locator("p").first()).toHaveCSS("line-height", "27.2px");
  await expect(page.locator("#wiki-critical-style")).toHaveCount(1);
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
  expect(requests).toEqual([]);
});

test("the authoritative manifest replaces provisional navigation including removed entries", async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await prepare(page, html => html.replace('"tree":[', '"tree":[["f","retired-page"],'));
  await page.route("**/api/wiki/manifest*", async route => {await held; await route.fallback();});
  try {
    await page.goto("/", {waitUntil:"domcontentloaded"});
    await expect(article(page)).toBeVisible();
    const retired = page.getByTestId("wiki-sidebar").locator('a[href="/retired-page"]');
    await expect(retired).toBeVisible();
    release();
    await expect(retired).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar")).toContainText("logistics");
  } finally {release();}
});

// Baseline measured in the last Next.js reader (52e12889), at 1280 x 900.
// Check both paints: final screenshots alone missed the empty/mismatched sidebar.
for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme} sidebar preserves the Next.js geometry through delayed-script handoff`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme });
    await prepare(page);
    let releaseScripts!: () => void;
    let releaseManifest!: () => void;
    const scripts = new Promise<void>(resolve => { releaseScripts = resolve; });
    const manifest = new Promise<void>(resolve => { releaseManifest = resolve; });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await scripts;
      if (route.request().resourceType() === "stylesheet") return route.abort();
      if (new URL(route.request().url()).pathname === "/api/wiki/manifest") await manifest;
      await route.fallback();
    });
    const measure = (selector: string) => page.locator(selector).evaluate(sidebar => {
      const rows = Array.from(sidebar.querySelectorAll<HTMLElement>(".wiki-shell-tree-link, .wiki-shell-tree-directory"));
      return rows.map(row => {
        const rect = row.getBoundingClientRect();
        const icon = row.querySelector("svg")!;
        return { text: row.querySelector(".wiki-shell-tree-label")!.textContent,
          x: rect.x, y: rect.y, height: rect.height, width: rect.width,
          font: getComputedStyle(row).fontSize, iconX: icon.getBoundingClientRect().x,
          iconWidth: icon.getBoundingClientRect().width, opacity: getComputedStyle(icon).opacity,
          labelColor: getComputedStyle(row.querySelector(".wiki-shell-tree-label")!).color };
      });
    });
    try {
      await page.goto("/", { waitUntil: "commit" });
      const early = page.locator("#wiki-html-first .wiki-shell-sidebar");
      await expect(early).toContainText("logistics");
      const before = await measure("#wiki-html-first .wiki-shell-sidebar");
      expect(before.map(({ text, y, iconX, font }) => ({ text, y, iconX, font }))).toEqual([
        { text: "Comments", y: 56, iconX: 18, font: "14px" },
        { text: "Diagnostics", y: 86, iconX: 18, font: "14px" },
        { text: "index", y: 120, iconX: 18, font: "14px" },
        { text: "wiki", y: 154, iconX: 18, font: "16px" },
        { text: "logistics", y: 186, iconX: 44, font: "16px" },
      ]);
      for (const row of before) expect(row).toMatchObject({ x: 6, width: 244, height: 30, iconWidth: 16 });
      const footerBefore = await early.locator(".wiki-vite-sidebar-footer-pills").boundingBox();
      for (const control of await early.locator(".wiki-vite-sidebar-footer-pills a").all()) {
        expect((await control.boundingBox())!.height).toBe(40);
        await expect(control.locator("svg")).toHaveCSS("width", "16px");
      }
      await expect(early.locator(".html-first-sign-in")).toHaveAttribute("href", /reader-action=signin/);
      await page.evaluate(() => {
        const frames: number[] = [];
        Object.assign(window, { sidebarPaintFrames: frames });
        function sample() {
          const sidebar = document.querySelector("#wiki-html-first .wiki-shell-sidebar") ?? document.querySelector('#root [data-test-id="wiki-sidebar"]');
          frames.push(sidebar?.querySelectorAll(".wiki-shell-tree-directory").length ?? 0);
          if (frames.length < 300) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      releaseScripts();
      await expect(page.locator("#wiki-html-first")).toHaveCount(0);
      const live = page.locator('#root [data-test-id="wiki-sidebar"]');
      expect(await measure('#root [data-test-id="wiki-sidebar"]')).toEqual(before);
      expect(await live.locator(".wiki-vite-sidebar-footer-pills").boundingBox()).toEqual(footerBefore);
      for (const control of await live.locator(".wiki-vite-sidebar-footer-pills button").all()) {
        expect((await control.boundingBox())!.height).toBe(40);
      }
      const frames = await page.evaluate(() => (window as unknown as { sidebarPaintFrames: number[] }).sidebarPaintFrames);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every(count => count >= 2)).toBe(true);
      await live.getByRole("button", { name: "Expand logistics", exact: true }).hover();
      await expect(live.getByRole("button", { name: "Expand logistics", exact: true }).locator(".wiki-shell-tree-chevron")).toHaveCSS("opacity", "0.6");
      await live.getByRole("button", { name: "Expand logistics", exact: true }).click();
      const nested = live.locator('a[href="/wiki/logistics/insurance"]');
      await expect(nested).toBeVisible();
      expect((await nested.locator("svg").boundingBox())!.x).toBe(62);
    } finally { releaseScripts(); releaseManifest(); }
  });
}
