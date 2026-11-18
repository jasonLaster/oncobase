// SPIKE: bun spike/ssr/gap.ts — paint-to-responsive gap on the perf lab's
// mobile profile (390x844, DPR 3, 4x CPU, 1.6 Mbps / 750 Kbps, 150 ms RTT).
//
// Per cold load:
// - articlePaint: Element Timing renderTime of the article's first paragraph
//   (elementtiming="article", added to the SSR HTML).
// - hydrateCall: performance mark right before hydrateRoot.
// - regions: first frame where React has hydrated a node (own __reactProps$*):
//   header (search), nav (drawer trigger), actions (copy link), body (first
//   article link).
// - click at paint: a real CDP touch-free mouse click on the drawer trigger,
//   issued at the article paint instant (scheduled from a calibration load),
//   and the time the drawer actually opened (MutationObserver on the sheet's
//   `inert`). gap = drawerOpen - max(click, articlePaint).
// Env: SPIKE_PAGES=normal,panel18  SPIKE_RUNS=5  SPIKE_REPLAY=1  SPIKE_GATE=1
//      SPIKE_PROBE=click|shortcut|link|enter  SPIKE_OFFSET=<ms after paint>
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type CDPSession, type Page } from "playwright";
import { installSsrReplay } from "./replay";

const root = path.resolve(import.meta.dir, "../..");
const mod = await import(path.join(root, ".spike-ssr/entry-server.js"));
const { createElement } = await import("react");
const template = readFileSync(path.join(root, ".spike-client/spike/ssr/hydrate.html"), "utf8");
const port = Number(process.env.SPIKE_PORT ?? 62251);
const runs = Number(process.env.SPIKE_RUNS ?? 5);
const probe = process.env.SPIKE_PROBE ?? "click";
const offset = Number(process.env.SPIKE_OFFSET ?? 0);
const names = (process.env.SPIKE_PAGES ?? "normal,panel18").split(",");

// SPIKE_GATE=1: render-block on the entry module (its top-level await holds
// until the root pass commits), with a safety valve: removing a render-blocking
// element unblocks rendering, so a stalled bundle paints after SPIKE_GATE_MS.
const gateMs = Number(process.env.SPIKE_GATE_MS ?? 3000);
const gate = process.env.SPIKE_GATE === "1";
const headExtras = [
  gate ? `<script>setTimeout(function(){var s=document.querySelector('script[blocking=render]');if(s){s.removeAttribute('blocking');s.remove();performance.mark('ssr-gate-timeout')}},${gateMs})</script>` : "",
  process.env.SPIKE_REPLAY === "1" ? `<script id="ssr-replay">(${installSsrReplay.toString()})()</script>` : "",
  process.env.SPIKE_GATE_HEAD ?? "",
  process.env.SPIKE_PALETTE === "1" ? "<script>document.documentElement.dataset.spikePalette='1'</script>" : "",
  // P14 preview: skip layout of off-screen sections.
  process.env.SPIKE_CV === "1" ? "<style>.wiki-markdown-sections > .wiki-markdown{content-visibility:auto;contain-intrinsic-size:auto 1400px}</style>" : "",
].join("");

async function serverHtml(name: string) {
  const fx = JSON.parse(readFileSync(path.join(import.meta.dir, `fixtures/${name}.json`), "utf8"));
  const md = fx.initial.page.content;
  if (mod.mayContainMath(md)) await mod.preloadMarkdownMath();
  if (mod.documentMayNeedRawHtml(md)) await mod.preloadRawHtml();
  const stream = await mod.renderToReadableStream(createElement(mod.ServerFirstFrame, fx));
  await stream.allReady;
  let body = await new Response(stream).text();
  const article = body.indexOf('class="wiki-markdown');
  const p = body.indexOf("<p", article);
  body = body.slice(0, p) + '<p elementtiming="article"' + body.slice(p + 2);
  const json = JSON.stringify(fx).replace(/</g, "\\u003c");
  const page = gate ? template.replace(/<script type="module" crossorigin src="(\/assets\/hydrate-[^"]+)"><\/script>/, '<script type="module" blocking="render" crossorigin src="$1"></script>') : template;
  if (gate && page === template) throw new Error("gate: entry script not found");
  return { fx, html: page.replace("<!--spike-head-->", headExtras).replace("<!--spike-root-->", body)
    .replace("<!--spike-fixture-->", `<script id="spike-fixture" type="application/json">${json}</script>`) };
}

const pages = new Map<string, { name: string; html: string }>();
for (const name of names) {
  const { fx, html } = await serverHtml(name);
  pages.set(fx.url, { name, html });
}
const gz = (body: Uint8Array | string, type: string) => new Response(Bun.gzipSync(typeof body === "string" ? new TextEncoder().encode(body) : body),
  { headers: { "Content-Type": type, "Content-Encoding": "gzip", "Cache-Control": "no-store" } });
const server = Bun.serve({ port, async fetch(request) {
  const url = new URL(request.url);
  const page = pages.get(url.pathname);
  if (page) return gz(page.html, "text/html; charset=utf-8");
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "spike" }, { status: 404 });
  const file = Bun.file(path.join(root, ".spike-client", url.pathname));
  if (!(await file.exists())) return new Response("<!doctype html><title>other page</title>", { headers: { "Content-Type": "text/html" } });
  return /\.(js|css|svg|json|html)$/.test(url.pathname) ? gz(new Uint8Array(await file.arrayBuffer()), file.type) : new Response(file);
} });

function initScript() {
  const w = window as any;
  const s = w.__GAP__ = { regions: {} as Record<string, number>, long: [] as { start: number; duration: number }[], events: [] as any[], articlePaint: -1, lcp: -1, drawerOpen: -1, dialogOpen: -1 };
  new PerformanceObserver(list => { for (const e of list.getEntries() as any[]) if (e.identifier === "article") s.articlePaint = e.renderTime || e.loadTime; })
    .observe({ type: "element", buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries()) s.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries()) s.long.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) }); })
    .observe({ type: "longtask", buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries() as any[]) if (["click", "keydown", "pointerdown"].includes(e.name)) s.events.push({ name: e.name, start: Math.round(e.startTime), processingStart: Math.round(e.processingStart), duration: Math.round(e.duration) }); })
    .observe({ type: "event", buffered: true, durationThreshold: 16 } as any);
  const regions: Record<string, string> = { header: '[data-test-id="mobile-header-search"]', nav: '[data-test-id="bottom-nav-trigger"]',
    actions: '[aria-label="Copy page link"]', body: ".wiki-markdown p" };
  const poll = () => {
    for (const [name, selector] of Object.entries(regions)) {
      if (s.regions[name]) continue;
      const el = document.querySelector(selector);
      if (el && Object.keys(el).some(k => k.startsWith("__reactProps$"))) s.regions[name] = Math.round(performance.now());
    }
    const sheet = document.querySelector('[data-test-id="bottom-nav-sheet"]');
    if (s.drawerOpen < 0 && sheet && !sheet.hasAttribute("inert")) s.drawerOpen = Math.round(performance.now());
    if (s.dialogOpen < 0 && document.querySelector('[role="dialog"]')) s.dialogOpen = Math.round(performance.now());
    if (Object.keys(s.regions).length < 4 || s.drawerOpen < 0) setTimeout(poll, 2);
  };
  poll();
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(() => {
      const sheet = document.querySelector('[data-test-id="bottom-nav-sheet"]');
      if (s.drawerOpen < 0 && sheet && !sheet.hasAttribute("inert")) s.drawerOpen = Math.round(performance.now());
      if (s.dialogOpen < 0 && document.querySelector('[role="dialog"]')) s.dialogOpen = Math.round(performance.now());
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  document.addEventListener("click", e => { if (e.isTrusted) s.clickAt = Math.round(e.timeStamp); }, true);
  window.addEventListener("click", e => { const a = (e.target as Element).closest?.("a[href]"); if (a && e.isTrusted) { const rec = { live: Object.keys(a).some(k => k.startsWith("__reactProps")), defaultPrevented: e.defaultPrevented, href: a.getAttribute("href") }; try { sessionStorage.setItem("spike-link", JSON.stringify(rec)); } catch {} } });
  document.addEventListener("keydown", e => { if (e.isTrusted) s.keyAt = Math.round(e.timeStamp); }, true);
}

async function throttle(cdp: CDPSession) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
}

const browser = await chromium.launch();
async function load(url: string, schedule?: { at: number; x: number; y: number }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: false });
  await context.addInitScript(initScript);
  if (process.env.SPIKE_BLOCK_JS === "1") await context.route(/\/assets\/hydrate-[^/]+\.js$/, route => route.abort());
  const page: Page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await throttle(cdp);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message.slice(0, 160)));
  const t0 = Date.now();
  let fired: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (schedule) {
    timer = setTimeout(() => {
      if (probe === "shortcut") {
        fired = (async () => {
          await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 2 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 2 });
        })();
      } else {
        fired = (async () => {
          await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: schedule.x, y: schedule.y, button: "left", clickCount: 1 });
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: schedule.x, y: schedule.y, button: "left", clickCount: 1 });
        })();
      }
    }, Math.max(0, schedule.at));
  }
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "commit" });
  if (probe === "link" && schedule) {
    await page.waitForURL(u => !u.pathname.startsWith(url), { timeout: 20_000 }).catch(() => {});
    const navigated = !page.url().endsWith(url);
    const kind = await page.evaluate(() => ({ doc: document.title === "other page" ? "new document" : "same document", click: sessionStorage.getItem("spike-link") })).catch(() => "unknown");
    await context.close();
    return { navigated, kind, url: page.url() };
  }
  await page.waitForFunction(() => { const s = (window as any).__GAP__; return s && s.articlePaint > 0 && Object.keys(s.regions).length >= 4; }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  if (schedule) await page.waitForFunction(probe === "shortcut" ? () => (window as any).__GAP__.dialogOpen > 0 : () => (window as any).__GAP__.drawerOpen > 0, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  if (timer) clearTimeout(timer);
  await fired;
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const s = (window as any).__GAP__;
    const call = performance.getEntriesByName("ssr-hydrate-call")[0]?.startTime ?? -1;
    const committed = performance.getEntriesByName("ssr-root-committed")[0]?.startTime ?? -1;
    const gateTimeout = performance.getEntriesByName("ssr-gate-timeout").length > 0;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const recoverable = ((window as any).__SPIKE__?.recoverable ?? []).map((m: string) => m.slice(0, 200));
    const replay = ((window as any).__ssrReplay?.log ?? []).map((i: any) => ({ type: i.type, at: Math.round(i.at), replayedAt: i.replayedAt ? Math.round(i.replayedAt) : null, dropped: i.dropped ?? null }));
    const box = document.querySelector('[data-test-id="bottom-nav-trigger"]')!.getBoundingClientRect();
    const linkEl = [...document.querySelectorAll("[data-test-id='mobile-ask-wiki'], main a[href^='/']")].find(a => { const b = a.getBoundingClientRect(); return b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && getComputedStyle(a).visibility !== "hidden"; });
    const link = linkEl?.getBoundingClientRect();
    const linkLive = linkEl ? Object.keys(linkEl).some(k => k.startsWith("__reactProps")) : null;
    const linkInfo = linkEl ? { href: linkEl.getAttribute("href"), inBody: Boolean(linkEl.closest(".wiki-markdown")), live: linkLive } : null;
    return { linkInfo, prof: (window as any).__PROF__ ?? [], committed: Math.round(committed), gateTimeout, fcp: Math.round(fcp), recoverable, articlePaint: Math.round(s.articlePaint), lcp: Math.round(s.lcp), responseEnd: Math.round(nav.responseEnd), hydrateCall: Math.round(call), regions: s.regions,
      longAfterPaint: s.long.filter((t: any) => t.start + t.duration > s.articlePaint).map((t: any) => t.duration),
      longTimeline: s.long.filter((t: any) => t.start + t.duration > s.articlePaint).map((t: any) => `${t.start}+${t.duration}`),
      events: s.events, clickAt: s.clickAt ?? s.keyAt ?? null, drawerOpen: s.drawerOpen, dialogOpen: s.dialogOpen, replay,
      trigger: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, link: link ? { x: link.x + 4, y: link.y + link.height / 2 } : null };
  });
  await context.close();
  return { ...result, wallStart: t0, errors };
}

const out: any[] = [];
for (const [url, { name }] of pages) {
  // Calibration: when does the article paint, and where is the trigger.
  const cal: any = await load(url);
  // Wall-clock scheduling drifts from page time; correct it from each run.
  let skew = 0;
  // Two unrecorded runs converge the schedule onto the paint instant.
  const warmups = Number(process.env.SPIKE_WARMUPS ?? 2);
  for (let i = -warmups; i < runs; i++) {
    const target = probe === "link" ? cal.link : cal.trigger;
    const r: any = await load(url, { at: cal.articlePaint + offset - skew, x: target.x, y: target.y });
    if (probe !== "link" && r.clickAt != null) skew += (r.clickAt - r.articlePaint - offset) * 0.8;
    const responded = probe === "shortcut" ? r.dialogOpen : r.drawerOpen;
    if (i < 0) continue;
    if (probe === "link") { out.push({ page: name, run: i, probe, ...r }); continue; }
    out.push({ page: name, run: i, ...r, responded,
      clickAfterPaint: r.clickAt != null ? r.clickAt - r.articlePaint : null,
      gap: responded > 0 && r.clickAt != null ? responded - Math.max(r.clickAt, r.articlePaint) : null,
      chromeHydratedAfterPaint: Math.max(r.regions.header, r.regions.nav, r.regions.actions) - r.articlePaint });
  }
}
await browser.close();
server.stop(true);
console.log(JSON.stringify(out, null, 1));
