/** Compare production builds over real HTTP without disabling the browser cache.
 * Start two profile-bootstrap-cache.ts fixtures with PROFILE_SERVE=1,
 * PROFILE_DIST pointing at each build, and PROFILE_PORT=62173/62174. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const origins = { baseline: "http://127.0.0.1:62173", candidate: "http://127.0.0.1:62174" };
const output = ".playwright/identity-roundtrip/samples.json";
mkdirSync(".playwright/identity-roundtrip", { recursive: true });
const samples: unknown[] = [];
const browser = await chromium.launch();
try {
  for (const cpu of [1, 4]) for (const scope of ["public", "auto"]) for (let run = 1; run <= 3; run++) {
    for (const mode of (run % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) as (keyof typeof origins)[]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(() => {
          const w = window as typeof window & { __identityProbe?: { article: number; navigation: number; retractions: number; nodeChanges: number } };
          const probe = w.__identityProbe = { article: 0, navigation: 0, retractions: 0, nodeChanges: 0 };
          let original: Element | null = null;
          let wasVisible = false;
          function check() {
            const article = document.querySelector('#root [data-test-id="document-article"] .wiki-markdown');
            const visible = !!article && article.getBoundingClientRect().height > 0 && getComputedStyle(article).visibility !== "hidden";
            if (visible && !probe.article) {
              original = article;
              requestAnimationFrame(() => { probe.article ||= performance.now(); });
            }
            if (probe.article && original !== article && article) { probe.nodeChanges++; original = article; }
            if (wasVisible && !visible) probe.retractions++;
            wasVisible = visible;
            if (!probe.navigation && document.querySelector('[data-test-id="sidebar-search"]') && document.querySelector('[data-test-id="sidebar-tree"] a')) probe.navigation = performance.now();
            requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        });
        for (const visit of ["cold", "reload"]) {
          if (visit === "cold") await page.goto(origins[mode] + "/" + (scope === "public" ? "?scope=public" : ""), { waitUntil: "domcontentloaded" });
          else await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => (window as typeof window & { __identityProbe?: { article: number } }).__identityProbe?.article);
          await page.waitForTimeout(900);
          const data = await page.evaluate(() => {
            const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            return {
              ...(window as typeof window & { __identityProbe: object }).__identityProbe,
              html: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).responseEnd,
              identities: entries.filter(e => new URL(e.name).pathname === "/api/wiki/session").map(e => ({ query: new URL(e.name).search, start: e.startTime, end: e.responseEnd })),
              bodyRequests: entries.filter(e => new URL(e.name).pathname === "/api/wiki/pages").length,
              seeded: performance.getEntriesByName("wiki-page-bootstrap-seeded").length,
            };
          });
          const sample = { mode, cpu, scope, run, visit, errors: [...errors], ...data };
          samples.push(sample);
          console.log(JSON.stringify(sample));
          writeFileSync(output, JSON.stringify({ samples }, null, 2));
        }
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
