/** Compare ordinary and early React rendering against the synthetic server
 * started by PROFILE_SERVE=1 scripts/profile-bootstrap-cache.ts. No request
 * interception, real credentials, or real browser profiles are used. */
import { chromium } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const origin = process.argv[2];
if (!origin || new URL(origin).hostname !== "127.0.0.1") throw new Error("A loopback fixture URL is required");
const output = process.argv[3];
if (!output) throw new Error("A JSON output path is required");
const samples: unknown[] = [];
for (const cpu of [1, 4]) for (let run = 1; run <= 2; run++) {
  for (const early of run % 2 ? [false, true] : [true, false]) {
    const profile = await mkdtemp(path.join(tmpdir(), "early-reader-"));
    const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        const probe = () => {
          const body = document.querySelector("#root .wiki-markdown p");
          const search = document.querySelector('[data-test-id="sidebar-search"]');
          if (body && search && body.getBoundingClientRect().height > 0) {
            requestAnimationFrame(() => Object.assign(window, { readerFirstFrame: performance.now() }));
          } else requestAnimationFrame(probe);
        };
        requestAnimationFrame(probe);
      });
      for (const visit of ["cold", "reload", "hot"]) {
        if (visit === "cold") await page.goto(`${origin}/?scope=public&paintDebug=1${early ? "&readerBootstrap=1" : ""}`, { waitUntil: "domcontentloaded" });
        else await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => (window as unknown as { readerFirstFrame?: number }).readerFirstFrame);
        await page.waitForFunction(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length > 0);
        // Let authoritative sync and OPFS writes settle before the next reload.
        await page.waitForTimeout(900);
        const data = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(resource => new URL(resource.name).pathname.endsWith(".js"));
          return { articleMs: (window as unknown as { readerFirstFrame: number }).readerFirstFrame,
            htmlMs: navigation.responseEnd,
            storeSeedMs: performance.getEntriesByName("wiki-page-bootstrap-seeded")[0]?.startTime,
            handoffMs: performance.getEntriesByName("wiki-reader-live-handoff")[0]?.startTime ?? null,
            jsTransferBytes: scripts.reduce((sum, resource) => sum + resource.transferSize, 0) };
        });
        const sample = { cpu, run, early, visit, ...data, errors: [...errors] };
        samples.push(sample);
        console.log(JSON.stringify(sample));
        if (errors.length) throw new Error("The synthetic reader reported a browser error");
      }
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
}
await writeFile(output, JSON.stringify({ fixture: { pages: 2, sessionMs: 200, manifestMs: 400, bodyMs: 350,
  network: "loopback HTTP with gzip, no added latency", browser: "headless Chromium, fresh persistent profile per mode/run" }, samples }, null, 2));
