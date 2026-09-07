/** Read-only experiment. Uses live public content, a loopback-only gate session,
 * and an existing production build. Never writes remote data or saves cookies.
 * The HTML-first mode is a headroom experiment, not a production renderer.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

declare global {
  interface Window {
    __INITIAL_PAGE_PROBE__: { readable: number; article: number; snapshot: number; sidebar: number; ready: number };
  }
}

const distDir = resolve(process.argv[2] ?? "apps/app/dist");
const output = resolve(process.argv[3] ?? ".playwright/initial-page");
await mkdir(output, { recursive: true });
process.env.NODE_ENV = "development";
process.env.WIKI_SITE_SLUG = "diana";
process.env.WIKI_GATE_SESSION_SECRET = crypto.randomUUID();
// Prevent optional prefetch mutations and external telemetry in this experiment.
delete process.env.WIKI_PREFETCH_SECRET;
process.env.WIKI_BACKEND_TRACING = "0";
const { createClient, getPasswordGateConfig, authedCookieName } = await import("../server/wiki-api");
const { createWikiViteHandler } = await import("../server/app-shell");
const { createWikiGateSession } = await import("@oncobase/wiki-content/gate-session");
const { installVisualStabilityObserver } = await import("../src/visual-stability");
const client = createClient();
const config = await getPasswordGateConfig(client, "diana");
const token = await createWikiGateSession({ siteSlug: "diana", secret: process.env.WIKI_GATE_SESSION_SECRET,
  gateVersion: JSON.stringify([config.enabled, config.passwordHash ?? process.env.DIANA_WIKI_PASSWORD_HASH ?? "passwordless"]) });
const handler = createWikiViteHandler({ client, distDir });
let htmlFirst = false;
let snapshot = "";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, async fetch(request) {
  const response = await handler(request);
  if (htmlFirst && snapshot && new URL(request.url).pathname === "/" && response.status === 200 && response.headers.get("content-type")?.includes("text/html")) {
    const html = (await response.text()).replace('<div id="wiki-first-frame-snapshot" hidden></div>',
      '<div id="wiki-first-frame-snapshot" aria-busy="true" aria-disabled="true">' + snapshot + '</div><script>document.documentElement.dataset.wikiFirstFrame="true"</script>');
    return new Response(html, { status: response.status, headers: response.headers });
  }
  return response;
} });
const origin = `http://127.0.0.1:${server.port}`;
console.log(JSON.stringify({ phase: "server-ready", origin }));
const browser = await chromium.launch();
const samples: unknown[] = [];
async function contextFor(cpu: number) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { "x-wiki-test-run": "1" } });
  await context.addCookies([{ name: authedCookieName("diana"), value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.addInitScript(installVisualStabilityObserver);
  await page.addInitScript(() => {
    const probe = { readable: 0, article: 0, snapshot: 0, sidebar: 0, ready: 0 };
    Object.assign(window, { __INITIAL_PAGE_PROBE__: probe });
    const check = () => {
      const cached = document.querySelector('#wiki-first-frame-snapshot:not([hidden]) .wiki-markdown p');
      const live = document.querySelector('#root [data-test-id="document-article"] .wiki-markdown p');
      if (cached && !probe.snapshot) probe.snapshot = performance.now();
      if (live && !probe.article) probe.article = performance.now();
      if ((cached || live) && !probe.readable) probe.readable = performance.now();
      if (document.querySelector('#root [data-test-id="wiki-sidebar"] a[href="/"]') && !probe.sidebar) probe.sidebar = performance.now();
      if (live && !document.documentElement.dataset.wikiFirstFrame && !probe.ready) probe.ready = performance.now();
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-wiki-first-frame", "hidden"] });
  });
  return { context, page };
}
try {
  // Capture the already-rendered public shell once; this measures the best-case
  // effect of serving a precomputed representation after normal authorization.
  const seed = await contextFor(1);
  await seed.page.goto(origin + "/?scope=public", { waitUntil: "domcontentloaded" });
  await seed.page.locator('#root [data-test-id="document-article"] .wiki-markdown p').first().waitFor({ timeout: 60000 });
  await seed.page.screenshot({ path: resolve(output, "seed.png") });
  await seed.page.waitForFunction(() => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some(k => k?.startsWith("wiki-vite:first-frame:")), undefined, { timeout: 60000 });
  snapshot = await seed.page.evaluate(() => {
    const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).find(k => k?.startsWith("wiki-vite:first-frame:"));
    return key ? JSON.parse(localStorage.getItem(key)!).html : "";
  });
  if (!snapshot) throw new Error("No validated public snapshot captured");
  const seedInfo = await seed.page.evaluate(() => ({ runtime: (window.__WIKI_VITE_OBSERVABILITY__ as { runtime?: unknown })?.runtime, articleChars: document.querySelector('.wiki-markdown')?.textContent?.length }));
  console.log(JSON.stringify({ phase: "seed-ready", ...seedInfo, snapshotGzipBytes: gzipSync(snapshot).length }));
  await seed.context.close();
  for (const cpu of [1, 4]) for (let run = 1; run <= 3; run++) {
    // Alternate order to limit systematic backend warming bias.
    for (const mode of run % 2 ? ["fixed", "html-first"] : ["html-first", "fixed"]) {
      htmlFirst = mode === "html-first";
      const { context, page } = await contextFor(cpu);
      let pageErrors = 0;
      page.on("pageerror", () => pageErrors++);
      try {
        for (const visit of ["cold", "reload"]) {
          if (visit === "cold") await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
          else await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => window.__INITIAL_PAGE_PROBE__?.ready > 0, undefined, { timeout: 60000 });
          // Wait for snapshot persistence before measuring the repeat visit.
          await page.waitForFunction(() => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some(k => k?.startsWith("wiki-vite:first-frame:")), undefined, { timeout: 60000 });
          const data = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            return { ...window.__INITIAL_PAGE_PROBE__, ttfb: nav.responseStart, responseEnd: nav.responseEnd,
              fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
              resources: resources.filter(r => new URL(r.name).origin === location.origin).map(r => ({ path: new URL(r.name).pathname, start: r.startTime, end: r.responseEnd, transferBytes: r.transferSize, encodedBytes: r.encodedBodySize, decodedBytes: r.decodedBodySize })),
              phases: window.__WIKI_VISUAL_STABILITY__?.report().events.filter(e => e.kind.startsWith("phase:") || e.kind === "paint" || e.kind === "appearance"),
              runtime: (window.__WIKI_VITE_OBSERVABILITY__ as { runtime?: unknown })?.runtime,
              clientReportedRouteMs: window.__WIKI_VITE_OBSERVABILITY__?.metrics?.lastRouteRenderMs };
          });
          const result = { mode, cpu, run, visit, pageErrors, ...data };
          samples.push(result);
          console.log(JSON.stringify({ mode, cpu, run, visit, pageErrors, readable: Math.round(data.readable), ready: Math.round(data.ready), ttfb: Math.round(data.ttfb), fcp: data.fcp }));
          await writeFile(resolve(output, "samples.json"), JSON.stringify({ seedInfo, snapshotGzipBytes: gzipSync(snapshot).length, samples }, null, 2));
          if (run === 1 && cpu === 1) await page.screenshot({ path: resolve(output, `${mode}-${visit}.png`) });
        }
      } finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
