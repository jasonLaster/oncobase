/** Authenticated, unmocked production measurements. Never records bodies or cookies. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.WIKI_PERF_ORIGIN ?? "https://diana-tnbc.com";
const runs = Number(process.env.WIKI_PERF_RUNS ?? "3");
const paths = (process.env.WIKI_PERF_PATHS ?? "/,/wiki/logistics/insurance").split(",");
const phase = process.env.WIKI_PERF_PHASE ?? "baseline";
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error("Invalid phase");
const output = `.playwright/production-reading/${phase}`;
await mkdir(output, { recursive: true });
const password = process.env.WIKI_PERF_PASSWORD;
if (!password) throw new Error("WIKI_PERF_PASSWORD is required");
const response = await fetch(origin + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }), redirect: "manual" });
const cookie = response.headers.get("set-cookie")?.split(";")[0];
if (!response.ok || !cookie) throw new Error("Authorized login failed");
await response.body?.cancel();
const split = cookie.indexOf("=");
const browser = await chromium.launch();
const samples: Record<string, unknown>[] = [];
let stage = "setup";
try {
  for (let run = 0; run < runs; run++) for (const pathname of paths) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    let errors = 0;
    page.on("pageerror", () => errors++);
    await page.addInitScript(() => {
      const probe = { readable: 0, textPaint: 0, candidate: 0, live: 0, source: "", cls: 0 };
      Object.assign(window, { __READING_PROBE__: probe });
      if (PerformanceObserver.supportedEntryTypes.includes("element")) {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries() as (PerformanceEntry & { identifier: string; renderTime: number; intersectionRect: DOMRectReadOnly })[]) {
            if (entry.identifier === "wiki-body-text" && entry.renderTime > 0 && entry.intersectionRect.height > 0 && !probe.textPaint) probe.textPaint = entry.renderTime;
          }
        }).observe({ type: "element", buffered: true });
        const annotate = () => {
          for (const selector of ["#wiki-html-first .wiki-markdown p", "#root .wiki-markdown p"]) {
            document.querySelector(selector)?.setAttribute("elementtiming", "wiki-body-text");
          }
        };
        new MutationObserver(annotate).observe(document, { childList: true, subtree: true });
      }
      new PerformanceObserver(list => {
        for (const e of list.getEntries() as (PerformanceEntry & {value: number;hadRecentInput: boolean})[]) if (!e.hadRecentInput) probe.cls += e.value;
      }).observe({type: "layout-shift", buffered: true});
      const check = () => {
        const sources = ["#wiki-html-first", "#wiki-first-frame-snapshot:not([hidden])", "#root"];
        for (const source of sources) {
          const markdown = document.querySelector<HTMLElement>(source + " .wiki-markdown");
          const node = markdown?.querySelector<HTMLElement>("p,li,h1,h2,table");
          if (!node || !node.innerText.trim()) continue;
          const box = node.getBoundingClientRect();
          const visible = node.checkVisibility({checkVisibilityCSS: true, checkOpacity: true}) && box.width > 0 && box.height > 0;
          if (!visible) continue;
          // Styles must have applied, not just text attached to the DOM.
          if (getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() === "") continue;
          if (source === "#root" && !probe.live) probe.live = performance.now();
          if (!probe.candidate) {
            probe.candidate = performance.now(); probe.source = source;
            requestAnimationFrame(() => requestAnimationFrame(() => { probe.readable = performance.now(); }));
          }
          break;
        }
        if (!probe.live) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    for (const state of ["cold", "reload"]) {
      stage = `${run}:${pathname}:${state}`;
      const documentResponse = state === "cold"
        ? await page.goto(origin + pathname, { waitUntil: "commit", timeout: 60000 })
        : await page.reload({ waitUntil: "commit", timeout: 60000 });
      await page.waitForFunction(() => (window as any).__READING_PROBE__?.readable > 0, undefined, { timeout: 60000 });
      await page.waitForFunction(() => (window as any).__READING_PROBE__?.live > 0, undefined, { timeout: 60000 });
      const sample = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        return { ...(window as any).__READING_PROBE__, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
          ttfb: nav.responseStart, requestStart: nav.requestStart, dns: nav.domainLookupEnd-nav.domainLookupStart,
          connect: nav.connectEnd-nav.connectStart, htmlEnd: nav.responseEnd, htmlBytes: nav.encodedBodySize,
          server: nav.serverTiming.map(t=>({name:t.name,duration:t.duration})),
          resources: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(r=>({path:new URL(r.name).pathname,start:r.startTime,end:r.responseEnd,bytes:r.transferSize})) };
      });
      const record = {run,pathname,state,status:documentResponse?.status(),cache:documentResponse?.headers()["cache-control"],errors,...sample};
      samples.push(record);
      await writeFile(output + "/samples.json", JSON.stringify({origin,phase,measuredAt:new Date().toISOString(),viewport:{width:1440,height:1000},cpu:1,network:"unthrottled; fresh context per path/iteration; login outside browser; no mocked requests",samples},null,2));
      console.log(JSON.stringify({run,pathname,state,readable:Math.round(sample.readable),textPaint:sample.textPaint,fcp:sample.fcp,ttfb:Math.round(sample.ttfb),live:Math.round(sample.live),errors}));
    }
    await context.close();
  }
} catch {
  console.error(`Production reading measurement failed at ${stage}; request details withheld.`);
  process.exitCode = 1;
} finally { await browser.close(); }
