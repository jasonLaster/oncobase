// Manifest polling observed on an idle, visible, signed-in tab.
import { ARTICLE, instrument, newContext, settle, type Browser } from "./browser";
import { PAGES } from "./vault";

export type PollingSample = {
  windowSeconds: number;
  manifestRequests: number;
  manifestPerMinute: number;
  /** Manifest responses that were 304 Not Modified. */
  manifestNotModified: number;
  manifestBytes: number;
  otherApiRequests: number;
};

/**
 * Count manifest requests over a fixed window with the tab visible. Reported
 * as a rate rather than asserted: the polling policy is expected to change
 * (visible-only with backoff), and this number should move when it does.
 * Headless Chromium keeps the page "visible" throughout; nothing here tries to
 * hide it (bringToFront on another page does not).
 */
export async function runPolling(browser: Browser, base: string, windowSeconds: number): Promise<PollingSample> {
  const context = await newContext(browser, base, "desktop", { signedIn: true });
  try {
    const page = await context.newPage();
    const tools = await instrument(page, "desktop", base);
    await page.goto(`${base}/${PAGES.article}`, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForSelector(ARTICLE, { timeout: 60_000 });
    await settle(page, 3000);
    const startedAt = await page.evaluate(() => performance.now());
    await page.waitForTimeout(windowSeconds * 1000);
    const visibility = await page.evaluate(() => document.visibilityState);
    if (visibility !== "visible") throw new Error(`polling window ended with the tab ${visibility}`);
    const api = (await tools.requests()).filter((r) => r.start >= startedAt && r.path.startsWith("/api/"));
    const manifest = api.filter((r) => r.path.startsWith("/api/wiki/manifest"));
    return {
      windowSeconds,
      manifestRequests: manifest.length,
      manifestPerMinute: Number((manifest.length / (windowSeconds / 60)).toFixed(2)),
      manifestNotModified: manifest.filter((r) => r.status === 304).length,
      manifestBytes: manifest.reduce((a, r) => a + r.bytes, 0),
      otherApiRequests: api.length - manifest.length,
    };
  } finally {
    await context.close();
  }
}
