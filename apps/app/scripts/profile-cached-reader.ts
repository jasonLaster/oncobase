/** Content-free measurements against the loopback fixture, with real HTTP
 * caching and no request interception. Each CPU case starts a fresh profile. */
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const [origin, output] = process.argv.slice(2);
if (!origin || new URL(origin).hostname !== "127.0.0.1" || !output) throw new Error("Provide a loopback fixture URL and output JSON path");
const samples: unknown[] = [];
for (const cpu of [1, 4]) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const frame = () => {
        const body = document.querySelector("#root .wiki-markdown p");
        if (body && body.getBoundingClientRect().height > 0 && document.querySelector('[data-test-id="sidebar-search"]')) {
          requestAnimationFrame(() => Object.assign(window, { cachedReaderFrame: performance.now() }));
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    for (const visit of ["cold", "cached", "cached", "comparison", "cached"]) {
      const url = `${origin}/?paintDebug=1${visit === "comparison" ? "&readerCache=0" : ""}`;
      if (page.url() === url) await page.reload({ waitUntil: "domcontentloaded" });
      else await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as unknown as { cachedReaderFrame?: number }).cachedReaderFrame);
      const measured = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        return { articleMs: (window as unknown as { cachedReaderFrame: number }).cachedReaderFrame,
          htmlMs: navigation.responseEnd, cachedStartup: !!document.querySelector('[data-reader-cache-startup="true"]'),
          storeReadyAtObservation: document.querySelector('[data-reader-store-ready]')?.getAttribute("data-reader-store-ready"),
          jsTransferBytes: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
            .filter(resource => new URL(resource.name).pathname.endsWith(".js")).reduce((sum, resource) => sum + resource.transferSize, 0) };
      });
      await page.waitForFunction(() => document.querySelector('[data-reader-store-ready="true"]'));
      await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:startup:")));
      // The fixture's background manifest/body responses take 400/350 ms.
      await page.waitForTimeout(900);
      const sample = { cpu, visit, ...measured, errors: [...errors] };
      samples.push(sample); console.log(JSON.stringify(sample));
      if (errors.length) throw new Error("Reader browser errors");
    }
  } finally { await browser.close(); }
}
await writeFile(output, JSON.stringify({ conditions: "Synthetic loopback server, real HTTP cache, headless Chromium, 1440x1000; no request interception", samples }, null, 2));
