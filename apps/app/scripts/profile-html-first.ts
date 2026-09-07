/** Paired local measurements and failure probes against serve-html-first-experiment.ts.
 * Writes only timing/geometry aggregates. Screenshots stay in ignored .playwright/.
 */
import { chromium, webkit, expect, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const origin = process.env.HTML_FIRST_ORIGIN ?? "http://127.0.0.1:62009";
if (new URL(origin).hostname !== "127.0.0.1") throw new Error("Use the loopback experiment only");
const output = resolve(".playwright/html-first");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
// Fault probes intentionally hold parser-blocking resources. Playwright's font
// readiness wait otherwise waits for those held scripts, even with system fonts.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
const results: unknown[] = [];
const checks: string[] = [];
async function freshContext(engine: Browser, options: { javaScriptEnabled?: boolean; viewport?: { width: number; height: number } } = {}) {
  const context = await engine.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", ...options });
  const unlock = await fetch(origin + "/__experiment/start", { redirect: "manual" });
  const cookie = unlock.headers.get("set-cookie")!.split(";")[0];
  const separator = cookie.indexOf("=");
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
  return context;
}
function installProbe() {
  const probe = { readable: 0, early: 0, live: 0, ready: 0, earlyX: 0, earlyY: 0, earlyWidth: 0, cls: 0 };
  Object.assign(window, { __HTML_PROBE__: probe });
  new PerformanceObserver(list => {
    for (const e of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number })[]) if (!e.hadRecentInput) probe.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  const check = () => {
    const early = document.querySelector<HTMLElement>("#wiki-html-first .wiki-markdown");
    const snapshot = document.querySelector("#wiki-first-frame-snapshot:not([hidden]) .wiki-markdown");
    const live = document.querySelector<HTMLElement>('#root [data-test-id="document-article"] .wiki-markdown');
    if (early && !probe.early) {
      probe.early = performance.now();
      const box = early.getBoundingClientRect();
      probe.earlyX = box.x; probe.earlyY = box.y; probe.earlyWidth = box.width;
    }
    if (live && !probe.live) probe.live = performance.now();
    if (!probe.readable && (early || snapshot || live)) probe.readable = performance.now();
    if (live && !early && !document.documentElement.dataset.wikiFirstFrame && !probe.ready) probe.ready = performance.now();
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
}
async function ready(page: Page) {
  await page.waitForFunction(() => !document.getElementById("wiki-html-first") &&
    !document.documentElement.dataset.wikiFirstFrame && document.querySelector('#root [data-test-id="document-article"] .wiki-markdown'), undefined, { timeout: 60000 });
}

try {
  if (process.env.HTML_FIRST_PROFILE_ONLY !== "1") {
  // The early page remains readable with JavaScript disabled, including actual
  // navigation to a second server-rendered article.
  const noJs = await freshContext(browser, { javaScriptEnabled: false });
  const noJsPage = await noJs.newPage();
  await noJsPage.goto(origin);
  await expect(noJsPage.locator("#wiki-html-first article")).toBeVisible();
  await noJsPage.locator("#wiki-html-first article a[href]").first().click();
  await expect(noJsPage).not.toHaveURL(origin + "/");
  await expect(noJsPage.locator("#wiki-html-first article")).toBeVisible();
  checks.push("No JavaScript: full home article and native navigation to another article");
  await noJs.close();

  // Deliberately hold the entire manifest. Article handoff must be independent.
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await freshContext(browser, { viewport });
    const page = await context.newPage();
    let releaseScripts!: () => void;
    let releaseManifest!: () => void;
    const scriptsHeld = new Promise<void>(r => { releaseScripts = r; });
    const manifestHeld = new Promise<void>(r => { releaseManifest = r; });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await scriptsHeld;
      if (new URL(route.request().url()).pathname === "/api/wiki/manifest") await manifestHeld;
      await route.continue();
    });
    try {
      await page.goto(origin, { waitUntil: "commit" });
      const early = page.locator("#wiki-html-first .wiki-markdown");
      await expect(early).toBeVisible();
      const box = await early.boundingBox();
      await expect(page.locator("#root")).toHaveAttribute("inert", "");
      await page.screenshot({ path: resolve(output, `early-${viewport.width}.png`) });
      const scroll = await page.locator("#wiki-html-first .content-shell").evaluate(el => { el.scrollTop = 900; return el.scrollTop; });
      releaseScripts();
      await ready(page);
      const live = page.locator('#root [data-test-id="document-article"] .wiki-markdown');
      const liveBox = await live.boundingBox();
      expect(Math.abs(box!.x - liveBox!.x)).toBeLessThan(2);
      expect(Math.abs(box!.width - liveBox!.width)).toBeLessThan(2);
      expect(await page.locator("#root .content-shell").evaluate(el => el.scrollTop)).toBeCloseTo(scroll, 0);
      await expect(page.locator("#root")).not.toHaveAttribute("inert");
      await page.screenshot({ path: resolve(output, `live-${viewport.width}.png`) });
      if (viewport.width > 767) {
        await page.getByRole("button", { name: "Open outline", exact: true }).click();
        await expect(page.locator('[data-test-id="page-outline"]')).toHaveAttribute("data-outline-state", "expanded");
      }
      checks.push(`${viewport.width}px: paused scripts readable, held manifest does not block handoff, article width and scroll preserved`);
    } finally {
      releaseScripts(); releaseManifest();
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }

  // Do not remove text while somebody selects it, or replace fresh server HTML
  // with a different revision from the browser's persistent cache.
  for (const scenario of ["selection", "revision", "focus"] as const) {
    const context = await freshContext(browser);
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") await held;
      await route.continue();
    });
    try {
      await page.goto(origin, { waitUntil: "commit" });
      await expect(page.locator("#wiki-html-first article")).toBeVisible();
      await page.evaluate(mode => {
        const host = document.getElementById("wiki-html-first")!;
        if (mode === "selection") {
          const range = document.createRange();
          range.selectNodeContents(host.querySelector(".wiki-markdown p")!);
          window.getSelection()!.addRange(range);
        } else if (mode === "revision") {
          // Oversized/legacy HTML can have no consumable bootstrap payload.
          document.getElementById("wiki-page-bootstrap")?.remove();
          host.dataset.hash = "deliberately-different-revision";
        }
        else host.querySelector<HTMLAnchorElement>("article a[href]")!.focus();
      }, scenario);
      release();
      await expect(page.locator('#root [data-test-id="document-article"] .wiki-markdown')).toBeAttached();
      if (scenario !== "focus") await expect(page.locator("#wiki-html-first")).toBeVisible();
      if (scenario === "selection") await page.evaluate(() => window.getSelection()!.removeAllRanges());
      if (scenario === "revision") {
        await page.getByRole("link", { name: "Open interactive reader", exact: true }).click();
        await expect(page).toHaveURL(/html-first=off/);
      }
      await ready(page);
      if (scenario === "focus") expect(await page.evaluate(() => document.querySelector("#root")!.contains(document.activeElement) && document.activeElement?.tagName === "A")).toBe(true);
      checks.push(`${scenario}: safe handoff or normal-reader escape verified`);
    } finally { release(); await page.unrouteAll({ behavior: "wait" }); await context.close(); }
  }

  // The bootstrap supplies the body even when the body endpoint is unavailable.
  const failed = await freshContext(browser);
  const failedPage = await failed.newPage();
  let bodyCalls = 0;
  await failedPage.route("**/api/wiki/pages?**", route => {
    bodyCalls++;
    return route.fulfill({ status: 503, body: "test unavailable" });
  });
  await failedPage.goto(origin);
  await ready(failedPage);
  expect(bodyCalls).toBe(0);
  checks.push("Blocked body API: payload hands off without a duplicate body request");
  await failed.close();

  const safari = await webkit.launch();
  try {
    const context = await freshContext(safari);
    const page = await context.newPage();
    const response = await page.goto(origin);
    expect(await response!.text()).toContain('id="wiki-html-first"');
    await ready(page);
    checks.push("WebKit: server HTML hands off to live reader");
    await context.close();
  } finally { await safari.close(); }

  console.log(JSON.stringify({ checks }));
  await writeFile(resolve(output, "checks.json"), JSON.stringify({ checks }, null, 2));
  }
  if (process.env.HTML_FIRST_CHECKS_ONLY === "1") process.exitCode = 0;
  else {
  for (const cpu of [1, 4]) for (let run = 1; run <= 3; run++) {
    for (const mode of run % 2 ? ["normal", "html-first"] : ["html-first", "normal"]) {
      const context = await freshContext(browser);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.addInitScript(installProbe);
      let errors = 0;
      page.on("pageerror", () => errors++);
      for (const visit of ["cold", "reload"]) {
        const response = visit === "cold"
          ? await page.goto(origin + (mode === "normal" ? "/?html-first=off" : "/"), { waitUntil: "domcontentloaded" })
          : await page.reload({ waitUntil: "domcontentloaded" });
        await ready(page);
        // Match the prior warm-load methodology: wait for a complete validated
        // snapshot before reloading. This wait is outside all measured timers.
        await page.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith("wiki-vite:first-frame:")), undefined, { timeout: 60000 });
        const data = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          const probe = (window as unknown as { __HTML_PROBE__: Record<string, number> }).__HTML_PROBE__;
          const box = document.querySelector('#root [data-test-id="document-article"] .wiki-markdown')!.getBoundingClientRect();
          return { ...probe, readable: probe.readable, ready: probe.ready,
            contentKey: document.querySelector('#root [data-test-id="document-article"]')?.getAttribute("data-content-key"),
            ttfb: nav.responseStart, responseEnd: nav.responseEnd,
            fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
            handoff: performance.getEntriesByName("wiki-html-first-handoff")[0]?.startTime,
            liveX: box.x, liveY: box.y, liveWidth: box.width,
            resources: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(e => ({ path: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd, transfer: e.transferSize })),
          };
        });
        const html = await response!.text();
        const result = { cpu, run, mode, visit, errors, htmlBytes: Buffer.byteLength(html), htmlGzipBytes: gzipSync(html).length,
          cacheControl: response!.headers()["cache-control"], ...data };
        results.push(result);
        console.log(JSON.stringify({ cpu, run, mode, visit, errors, readable: Math.round(data.readable), ready: Math.round(data.ready), fcp: data.fcp }));
        await writeFile(resolve(output, "samples.json"), JSON.stringify({ origin, checks, results }, null, 2));
      }
      await context.close();
    }
  }
  }
} finally { await browser.close(); }
