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

async function prepare(page: Page, mutate?: (html: string) => string, sessionAuthenticated = false, sourceContent = content, details = { slug: "index", title: "Home", tags: [] as string[] }) {
  const responseContent = applyPiiRedactions(sourceContent);
  const responsePage = { ...publicPage, ...details, content: responseContent,
    contentHash: createHash("sha256").update(`${details.slug}:${responseContent}`).digest("hex").slice(0, 24) };
  const api = await installWikiApiMocks(page, { sessionAuthenticated,
    pageOverrides: { [details.slug]: { content: sourceContent, title: details.title, tags: details.tags } } });
  // Exercise the real server renderer/boot script and production JS graph, but
  // use synthetic documents and API fixtures throughout this test.
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const criticalCss = await readFile(new URL("../.vercel-functions/reader-critical.css", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document" || url.pathname !== (details.slug === "index" ? "/" : `/${details.slug}`)) return route.fallback();
    const tree = buildFileTreeFromManifest([{slug:"index"}, {slug:"wiki/logistics/insurance"}]);
    let html = injectHtmlFirstPage(template, responsePage, url, "diana", criticalCss, renderReaderNavigation(tree, details.slug), tree);
    if (mutate) html = mutate(html);
    await route.fulfill({ contentType: "text/html", headers: { "Cache-Control": "private, no-store" }, body: html });
  });
  return api;
}
const article = (page: Page) => page.locator('#root [data-test-id="document-article"]');
const homeFetches = (urls: string[]) => urls.filter(url => new URL(url).searchParams.get("slugs")?.split(",").includes("index"));

for (const mobile of [false, true]) {
  const surface = mobile ? "mobile" : "desktop";
  test(`${surface} Ask wiki navigates before the reader scripts load`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await held;
      if (route.request().resourceType() === "document" && new URL(route.request().url()).pathname === "/chat") {
        return route.fulfill({ contentType: "text/html", body: "<h1>Chat destination</h1>" });
      }
      await route.fallback();
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator('#wiki-html-first a[href="/chat"]:visible').click();
      await expect(page).toHaveURL(/\/chat$/);
      await expect(page.getByRole("heading", { name: "Chat destination" })).toBeVisible();
    } finally { release(); }
  });

  test(`${surface} Ask wiki leaves the article immediately while chat code is loading`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    // Keep this navigation test independent of the live conversation backend.
    await page.routeWebSocket(/convex\.cloud/, socket => socket.close());
    await page.route("**/api/wiki/convex-token", route => route.fulfill({ json: {} }));
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let chatRequested = false;
    await page.route("**/assets/ChatPage-*.js", async route => {
      chatRequested = true;
      await held;
      await route.fallback();
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(article(page)).toBeVisible();
      await expect(page.locator("#wiki-html-first")).toHaveCount(0);
      await page.getByTestId(mobile ? "mobile-ask-wiki" : "sidebar-ask-wiki").click();
      await expect(page).toHaveURL(/\/chat$/);
      await expect.poll(() => chatRequested).toBe(true);
      // The pending import must not retain the previous article under /chat.
      await expect(article(page)).toBeHidden({ timeout: 1_000 });
      await expect(page.getByRole("status", { name: "Loading chat", exact: true })).toBeVisible();
      await page.goBack();
      await expect(article(page)).toContainText("BOOTSTRAPPED_HOME");
      release();
      await page.goForward();
      await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
      await expect(page.getByRole("status", { name: "Loading chat", exact: true })).toHaveCount(0);
    } finally { release(); }
  });
}

test("heading links keep their target through the initial HTML handoff", async ({ page }) => {
  await prepare(page, undefined, false, "[[#Risks & benefits|Jump to risks]]\n\n" +
    "A synthetic background paragraph with space to scroll.\n\n".repeat(50) +
    "## Risks & benefits\n\nThe target section.");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#wiki-html-first").getByRole("link", { name: "Jump to risks", exact: true }).click();
    await expect(page.locator("#wiki-html-risks--benefits")).toBeInViewport();
    release();
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await expect(article(page).locator("#risks--benefits")).toBeInViewport();
    await expect(page).toHaveURL(/#risks--benefits$/);
  } finally { release(); }
});

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
      await expect(early.locator(".html-first-sign-in")).toHaveAttribute("type", "button");
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


for (const shortcut of ["Meta+O", "Control+O", "Meta+Shift+O", "Meta+Shift+K"]) {
  test(`${shortcut} pressed before app scripts load opens the requested palette once ready`, async ({ page }) => {
    await prepare(page);
    let release!: () => void;
    const scripts = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await scripts;
      await route.fallback();
    });
    try {
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.locator("#wiki-html-first article")).toBeVisible();
      await page.keyboard.press(shortcut);
      release();
      await expect(page.locator("#wiki-html-first")).toHaveCount(0);
      const input = page.getByTestId("command-palette-input");
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      if (shortcut.endsWith("Shift+O")) await expect(input).toHaveAttribute("placeholder", "Find a heading");
      else if (shortcut.endsWith("Shift+K")) await expect(input).toHaveAttribute("placeholder", "Search commands...");
      else await expect(input).toHaveAttribute("aria-label", "Search pages");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("command-palette")).toHaveCount(0);
    } finally { release(); }
  });
}

for (const width of [1440, 393]) {
  for (const adopted of [false, true]) {
    test(`initial Search opens files at ${width}px ${adopted ? "after" : "before"} shortcut adoption`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await prepare(page);
      let release!: () => void;
      const scripts = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/*", async route => {
        if (route.request().resourceType() === "script") await scripts;
        await route.fallback();
      });
      try {
        await page.goto("/", { waitUntil: "commit" });
        const native = page.locator("#wiki-html-first");
        await expect(native.locator("article")).toBeVisible();
        if (adopted) {
          await native.locator("article p").first().evaluate(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            window.getSelection()!.addRange(range);
          });
          release();
          await expect(article(page).locator(".wiki-markdown")).toBeAttached();
        }
        const search = native.locator(width === 1440 ? ".html-first-search" : '[aria-label="Search files"]');
        await expect(search).toHaveAttribute("type", "button");
        await search.click();
        await expect(page).toHaveURL(/\/$/);
        release();
        const input = page.getByTestId("command-palette-input");
        await expect(input).toBeFocused();
        await expect(native).toHaveCount(0);
        await input.fill("insurance");
        await expect(page.getByRole("option").first()).toContainText("insurance");
        await input.press("Enter");
        await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
      } finally { release(); }
    });
  }
}

test("Cmd+O opens while a native text selection is retaining the initial article", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await scripts;
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
    release();
    await expect(article(page)).toBeAttached();
    await expect(page.locator("#wiki-html-first")).toBeVisible();
    await page.keyboard.press("Meta+O");
    await expect(page.getByTestId("command-palette-input")).toBeVisible();
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
  } finally { release(); }
});


test("file palette uses initial navigation until the authoritative manifest replaces it", async ({ page }) => {
  await prepare(page, html => html.replace('"tree":[', '"tree":[["f","retired-page"],'));
  let release!: () => void;
  const manifest = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/manifest*", async route => { await manifest; await route.fallback(); });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(article(page)).toBeVisible();
    await page.keyboard.press("Meta+O");
    const palette = page.getByTestId("command-palette");
    const input = page.getByTestId("command-palette-input");
    await input.fill("retired");
    await expect(palette.getByRole("option")).toContainText("retired");
    release();
    await expect(palette.getByRole("option")).toHaveCount(0);
    await input.fill("insurance");
    await expect(palette.getByRole("option").first()).toContainText("insurance");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await expect(palette).toHaveCount(0);
  } finally { release(); }
});

test("Escape cancels a palette request queued before application scripts load", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await scripts;
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("#wiki-html-first article")).toBeVisible();
    await page.keyboard.press("Meta+O");
    await page.keyboard.press("Escape");
    release();
    await expect(article(page)).toBeVisible();
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.keyboard.press("Meta+O");
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
  } finally { release(); }
});


for (const width of [393, 768, 1440, 1920]) {
  test(`article title, tags and readable tables survive delayed-script handoff at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 1000 });
    const source = "An introductory paragraph.\n\n## Options\n\n| Option | What it generally does | Relevance | Planning take |\n| --- | --- | --- | --- |\n| Critical illness insurance | Usually pays a lump sum after a covered diagnosis | Review the policy language and exclusions carefully | Review the actual certificate before deciding |";
    const title = "Insurance & supplemental benefits Planning";
    const tags = ["insurance", "open-enrollment", "supplemental-benefits", "disability", "fsa", "hsa"];
    await prepare(page, undefined, false, source, { slug: "wiki/logistics/insurance", title, tags });
    let release!: () => void;
    let releaseManifest!: () => void;
    const scripts = new Promise<void>(resolve => { release = resolve; });
    const manifest = new Promise<void>(resolve => { releaseManifest = resolve; });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await scripts;
      if (new URL(route.request().url()).pathname === "/api/wiki/manifest") await manifest;
      await route.fallback();
    });
    try {
      await page.goto("/wiki/logistics/insurance", { waitUntil: "commit" });
      const native = page.locator("#wiki-html-first");
      await expect(native.locator(".wiki-shell-tag-row a")).toHaveCount(tags.length);
      await expect(native.locator("h1")).toHaveText(title);
      const before = await native.locator(".wiki-shell-page-header").boundingBox();
      const titleBefore = await native.locator("h1").boundingBox();
      const tagsBefore = await native.locator(".wiki-shell-tag-row").boundingBox();
      const permalink = native.locator(".heading-anchor").first();
      await expect(permalink).toHaveCSS("opacity", "1");
      const headingBounds = (await native.locator("h2").first().boundingBox())!;
      const linkBounds = (await permalink.boundingBox())!;
      if (width >= 1024) expect(linkBounds.x).toBe(headingBounds.x - 24);
      else expect(linkBounds.x).toBeGreaterThan(headingBounds.x);
      const table = native.locator("table");
      await expect(table).toBeVisible();
      for (const cell of await table.locator("th").all()) expect((await cell.boundingBox())!.width).toBeGreaterThanOrEqual(160);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width < 768) {
        await expect(native.locator(".html-first-mobile-title")).toHaveText("insurance");
        const controls = native.locator(".html-first-mobile-action, .html-first-files > summary");
        for (const control of await controls.all()) {
          const bounds = (await control.boundingBox())!;
          expect(bounds.width).toBe(36); expect(bounds.height).toBe(36);
        }
      }
      if (width === 1440 && browserName === "chromium") {
        const copy = native.getByRole("button", { name: "Copy page as markdown" });
        await expect(copy).toBeEnabled();
        await copy.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`# ${title}\n\n${source}`);
      }
      release();
      await expect(native).toHaveCount(0);
      expect(await article(page).locator(".wiki-shell-page-header").boundingBox()).toEqual(before);
      expect(await article(page).locator("h1").boundingBox()).toEqual(titleBefore);
      expect(await article(page).locator(".wiki-shell-tag-row").boundingBox()).toEqual(tagsBefore);
      if (width < 768) {
        await page.getByTestId("bottom-nav-trigger").click();
        await expect(page.getByTestId("mobile-view-comments")).toHaveCSS("font-size", "14px");
        await expect(page.getByTestId("bottom-nav-page-tree").locator('a[href="/wiki/logistics/insurance"]')).toHaveCSS("font-size", "14px");
      } else {
        await page.getByTestId("sidebar-workspace-trigger").hover();
        await expect(page.getByTestId("wiki-sidebar").locator(".wiki-shell-tree-chevron").first()).toHaveCSS("opacity", "0.6");
      }
    } finally { release(); releaseManifest(); }
  });
}

for (const action of ["search", "signin", "cancel-signin"] as const) {
  test(`early ${action} preserves the sidebar while account discovery is delayed`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await prepare(page);
    let releaseScripts!: () => void;
    let releaseSession!: () => void;
    const scripts = new Promise<void>(resolve => { releaseScripts = resolve; });
    const session = new Promise<void>(resolve => { releaseSession = resolve; });
    await page.route("**/api/auth/session", async route => {
      await session;
      await route.fulfill({ json: { user: null } });
    });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await scripts;
      await route.fallback();
    });
    try {
      await page.goto("/", { waitUntil: "commit" });
      const native = page.locator("#wiki-html-first");
      await expect(native.locator(".html-first-sign-in")).toBeVisible();
      await page.evaluate(() => {
        const frames: { prompt: boolean; footerY: number; treeRows: number }[] = [];
        Object.assign(window, { authSidebarFrames: frames });
        const sample = () => {
          const sidebar = document.querySelector("#wiki-html-first .wiki-shell-sidebar") ?? document.querySelector('#root [data-test-id="wiki-sidebar"]');
          const prompt = sidebar?.querySelector(".wiki-shell-sidebar-sign-in");
          const footer = sidebar?.querySelector(".wiki-vite-sidebar-footer-pills");
          frames.push({ prompt: !!prompt && prompt.getBoundingClientRect().height > 0,
            footerY: footer?.getBoundingClientRect().y ?? -1,
            treeRows: sidebar?.querySelectorAll(".wiki-shell-tree-directory").length ?? 0 });
          if (frames.length < 600) requestAnimationFrame(sample);
        };
        sample();
      });
      await native.locator(action === "search" ? ".html-first-search" : ".html-first-sign-in").click();
      if (action === "cancel-signin") await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/$/);
      releaseScripts();
      await expect(native).toHaveCount(0);
      await expect(page.getByTestId("sidebar-sign-in").filter({ visible: true })).toBeVisible();
      if (action === "search") {
        await expect(page.getByTestId("command-palette-input")).toBeFocused();
        await page.keyboard.press("Escape");
      } else if (action === "signin") {
        await expect(page.getByTestId("wiki-auth-dialog").getByLabel("Email", { exact: true })).toBeFocused();
        await page.keyboard.press("Escape");
      }
      await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
      releaseSession();
      await page.getByTestId("sidebar-sign-in").filter({ visible: true }).click();
      await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("sidebar-sign-in").filter({ visible: true })).toBeFocused();
      const frames = await page.evaluate(() => (window as unknown as {
        authSidebarFrames: { prompt: boolean; footerY: number; treeRows: number }[];
      }).authSidebarFrames);
      expect(frames.length).toBeGreaterThan(2);
      expect(frames.every(frame => frame.prompt && frame.treeRows >= 2)).toBe(true);
      expect(new Set(frames.map(frame => frame.footerY)).size).toBe(1);
      await expect(page).toHaveURL(/\/$/);
    } finally { releaseScripts(); releaseSession(); }
  });
}

test("sign-in opens through retained native selection and handles auth failure and success in place", async ({ page }) => {
  await prepare(page);
  let user: { id: string; name: string; email: string } | null = null;
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user } }));
  let attempts = 0;
  await page.route("**/api/auth/signin", async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 401, json: { error: "Synthetic incorrect password" } });
    user = { id: "synthetic-user", name: "QA Reader", email: "reader@example.test" };
    await route.fulfill({ json: { user } });
  });
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await scripts;
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await page.locator("#wiki-html-first article p").first().evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      window.getSelection()!.addRange(range);
    });
    release();
    await expect(article(page)).toBeAttached();
    await page.locator("#wiki-html-first .html-first-sign-in").click();
    const dialog = page.getByTestId("wiki-auth-dialog");
    await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await dialog.getByLabel("Email", { exact: true }).fill("reader@example.test");
    await dialog.getByLabel("Password", { exact: true }).fill("synthetic-test-password");
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog).toContainText("Synthetic incorrect password");
    await expect(dialog.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("sidebar-sign-in")).toHaveCount(0);
    expect(attempts).toBe(2);
    await expect(page).toHaveURL(/\/$/);
  } finally { release(); }
});
