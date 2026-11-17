// SPIKE: bun spike/ssr/hydrate-check.ts
// Renders each fixture with the SSR bundle, serves it with the client build,
// and hydrates it in Chromium under several client conditions. Reports React's
// recoverable (mismatch) errors, layout shift after first paint, and timings
// on the perf lab's mobile profile. Port: SPIKE_PORT (default 62251).
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dir, "../..");
const mod = await import(path.join(root, ".spike-ssr/entry-server.js"));
const { createElement } = await import("react");
const template = readFileSync(path.join(root, ".spike-client/spike/ssr/hydrate.html"), "utf8");
const port = Number(process.env.SPIKE_PORT ?? 62251);

async function serverHtml(name: string) {
  const fx = JSON.parse(readFileSync(path.join(import.meta.dir, `fixtures/${name}.json`), "utf8"));
  const md = fx.initial.page.content;
  if (mod.mayContainMath(md)) await mod.preloadMarkdownMath();
  if (mod.documentMayNeedRawHtml(md)) await mod.preloadRawHtml();
  const stream = await mod.renderToReadableStream(createElement(mod.ServerFirstFrame, fx));
  await stream.allReady;
  const body = await new Response(stream).text();
  const json = JSON.stringify(fx).replace(/</g, "\\u003c");
  return { fx, html: template.replace("<!--spike-root-->", body)
    .replace("<!--spike-fixture-->", `<script id="spike-fixture" type="application/json">${json}</script>`) };
}

const pages = new Map<string, string>();
for (const name of ["normal", "panel18", "large30"]) {
  const { fx, html } = await serverHtml(name);
  pages.set(fx.url, html);
}
// gzip like production (the perf lab's proxy does the same); the reader's API is absent.
const gz = (body: Uint8Array | string, type: string) => new Response(Bun.gzipSync(typeof body === "string" ? new TextEncoder().encode(body) : body),
  { headers: { "Content-Type": type, "Content-Encoding": "gzip" } });
const server = Bun.serve({ port, async fetch(request) {
  const url = new URL(request.url);
  const page = pages.get(url.pathname);
  if (page) return gz(page, "text/html; charset=utf-8");
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "spike" }, { status: 404 });
  const file = Bun.file(path.join(root, ".spike-client", url.pathname));
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  return /\.(js|css|svg|json|html)$/.test(url.pathname) ? gz(new Uint8Array(await file.arrayBuffer()), file.type) : new Response(file);
} });

type Condition = { name: string; storage?: Record<string, string>; colorScheme?: "dark" | "light"; mobile?: boolean; offline?: boolean; throttle?: boolean };
const allConditions: Condition[] = [
  { name: "desktop, clean" },
  { name: "desktop, dark (system)", colorScheme: "dark" },
  { name: "desktop, saved sidebar width 360", storage: { "sidebar-width": "360" } },
  { name: "desktop, saved sidebar collapsed", storage: { "sidebar-width": "0" } },
  { name: "desktop, saved tree expansion", storage: { "wiki-vite-expanded-directories": JSON.stringify({ wiki: true, "wiki/treatment": false, sources: true }) } },
  { name: "desktop, navigator offline", offline: true },
  { name: "mobile 390px, clean", mobile: true },
  { name: "mobile 390px, lab throttling", mobile: true, throttle: true },
];
const conditions = process.env.SPIKE_ONLY ? allConditions.filter(c => c.name.includes(process.env.SPIKE_ONLY!)) : allConditions;
const repeat = Number(process.env.SPIKE_REPEAT ?? 1);

const browser = await chromium.launch();
const rows: unknown[] = [];
for (const url of pages.keys()) {
  for (const c of conditions.flatMap(c => Array.from({ length: repeat }, () => c))) {
    const context = await browser.newContext({
      viewport: c.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: c.mobile ? 3 : 1, isMobile: c.mobile, hasTouch: c.mobile, colorScheme: c.colorScheme ?? "light",
    });
    await context.addInitScript(({ storage, offline }) => {
      for (const [k, v] of Object.entries(storage ?? {})) localStorage.setItem(k, v);
      if (offline) Object.defineProperty(Navigator.prototype, "onLine", { get: () => false });
      (window as any).__CLS__ = [];
      new PerformanceObserver(list => { for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__CLS__.push({ value: e.value, at: e.startTime }); })
        .observe({ type: "layout-shift", buffered: true });
      (window as any).__LCP__ = 0;
      new PerformanceObserver(list => { for (const e of list.getEntries()) (window as any).__LCP__ = e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
      (window as any).__LONG__ = [];
      new PerformanceObserver(list => { for (const e of list.getEntries()) (window as any).__LONG__.push(Math.round(e.duration)); })
        .observe({ type: "longtask", buffered: true });
      // A control is live once React has attached its props to the server's node.
      const poll = () => {
        const button = document.querySelector('[data-test-id="mobile-header-search"]');
        if (button && Object.keys(button).some(key => key.startsWith("__reactProps"))) (window as any).__INTERACTIVE__ = performance.now();
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }, { storage: c.storage, offline: c.offline });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", e => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
    if (c.throttle) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    }
    await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
    await page.waitForFunction(() => (window as any).__SPIKE__?.hydratedAt, null, { timeout: 60_000 });
    await page.waitForTimeout(c.throttle ? 3000 : 800);
    const result = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
      const s = (window as any).__SPIKE__;
      return { recoverable: s.recoverable, fcp: Math.round(fcp ?? -1), lcp: Math.round((window as any).__LCP__), responseEnd: Math.round(nav.responseEnd),
        hydrationStart: Math.round(s.startedAt), hydrated: Math.round(s.hydratedAt), preloadMs: Math.round(s.preloadMs),
        cls: +((window as any).__CLS__ as { value: number }[]).reduce((a, e) => a + e.value, 0).toFixed(4),
        interactive: Math.round((window as any).__INTERACTIVE__ ?? -1), longestTask: Math.max(0, ...(window as any).__LONG__),
        articleInDom: Boolean(document.querySelector(".wiki-markdown p")), dark: document.documentElement.classList.contains("dark") };
    });
    rows.push({ url, condition: c.name, ...result, consoleErrors: consoleErrors.slice(0, 3) });
    await context.close();
  }
}
await browser.close();
server.stop(true);
console.log(JSON.stringify(rows, null, 2));
