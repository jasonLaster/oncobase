/** Cold mobile-size reader measurement against a synthetic loopback server.
 * bun apps/app/scripts/profile-slow-network.ts http://127.0.0.1:PORT
 * No production account, browser cache or saved page is used. */
import { chromium } from "@playwright/test";

const origin = process.argv[2];
if (!origin || new URL(origin).hostname !== "127.0.0.1") throw new Error("Provide a synthetic loopback reader URL");
async function profile() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors: string[] = [];
    const pending = new Set<string>();
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => pending.add(new URL(request.url()).pathname));
    page.on("requestfinished", request => pending.delete(new URL(request.url()).pathname));
    page.on("requestfailed", request => { pending.delete(new URL(request.url()).pathname); errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 256_000 / 8, uploadThroughput: 128_000 / 8, connectionType: "cellular3g" });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
    try {
      await page.waitForSelector('[data-test-id="document-article"] .wiki-markdown p', { timeout: 60_000 });
    } catch {
      const state = await page.evaluate(() => ({ status: document.querySelector('[data-test-id="page-activity"]')?.textContent,
        store: document.querySelector('[data-reader-store-ready]')?.getAttribute('data-reader-store-ready'),
        recovery: document.querySelector('[data-test-id="session-recovery"], [data-test-id="store-startup-recovery"]')?.textContent,
        resources: performance.getEntriesByType("resource").map(r => ({ path: new URL(r.name).pathname, ms: Math.round(r.duration) })) }));
      console.log(JSON.stringify({ status: "timed-out", state, pending: [...pending], errors }, null, 2));
      process.exitCode = 1;
      return;
    }
    const result = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const api = resources.filter(r => new URL(r.name).pathname.startsWith("/api/wiki/"));
      return { articleReadyMs: Math.round(performance.now()),
        observedResourceTransferBytes: resources.reduce((sum, r) => sum + r.transferSize, 0),
        api: api.map(r => ({ path: new URL(r.name).pathname, durationMs: Math.round(r.duration), bytes: r.transferSize })),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    console.log(JSON.stringify({ conditions: "Synthetic loopback, Chromium, 390x844, empty cache, 256 kbps download, 400 ms latency, 4x CPU slowdown; resource bytes exclude nested worker requests", ...result, errors }, null, 2));
    if (errors.length || result.horizontalOverflow) process.exitCode = 1;
  } finally { await browser.close(); }

}
await profile();
