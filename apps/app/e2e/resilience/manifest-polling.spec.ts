import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

// How the reader checks for updates when nobody asked. Production traces showed
// a few idle tabs producing most manifest requests: every tab polled on a fixed
// interval whether or not anyone was looking, and each check flipped the status
// region, which screen readers announced all day.

const insurance = "/wiki/logistics/insurance";
const status = (page: Page) => page.getByTestId("wiki-sidebar").getByTestId("navigation-status");

/** Advance the page clock in steps, letting each check's request resolve in between. */
async function advance(page: Page, totalMs: number, stepMs = 30_000) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await page.clock.fastForward(stepMs);
    await page.waitForTimeout(60);
  }
}

async function openIdleReader(page: Page) {
  await page.clock.install({ time: new Date("2026-07-30T12:00:00.000Z") });
  const requests = await installWikiApiMocks(page);
  await gotoWiki(page, insurance);
  await waitForPageTitle(page, "Insurance");
  await expect(status(page)).toHaveAttribute("data-freshness", "current");
  // The reader may issue more than one manifest request per cold load: count from a settled baseline.
  let last = -1;
  while (last !== requests.manifest.length) {
    last = requests.manifest.length;
    await page.waitForTimeout(600);
  }
  // Every change to the status region and to its freshness, from here on.
  await page.evaluate(() => {
    const root = document.querySelector('[data-test-id="wiki-sidebar"] [data-test-id="navigation-status"]')!;
    const record = { announcements: 0, freshness: [] as string[] };
    (window as Window & { __statusRecord?: typeof record }).__statusRecord = record;
    new MutationObserver(() => { record.announcements++; }).observe(root.querySelector('[role="status"]')!, { childList: true, subtree: true, characterData: true });
    new MutationObserver(() => { record.freshness.push(root.getAttribute("data-freshness") ?? ""); }).observe(root, { attributes: true, attributeFilter: ["data-freshness"] });
  });
  return { requests, baseline: last };
}

const statusRecord = (page: Page) => page.evaluate(() =>
  (window as Window & { __statusRecord?: { announcements: number; freshness: string[] } }).__statusRecord!);

test("an idle visible tab checks less and less often, and never announces it", async ({ page }) => {
  const { requests, baseline } = await openIdleReader(page);

  // Fifteen idle minutes. The old fixed interval made fifteen requests here;
  // backing off from one minute toward five makes four.
  await advance(page, 15 * 60_000);
  const checks = requests.manifest.length - baseline;
  expect(checks).toBeGreaterThanOrEqual(3);
  expect(checks).toBeLessThanOrEqual(5);

  // Nothing changed, so nothing was shown or announced.
  expect(await statusRecord(page)).toEqual({ announcements: 0, freshness: [] });
  await expect(status(page)).toHaveAttribute("data-freshness", "current");
});

test("a hidden tab stops checking and catches up when it is shown again", async ({ page }) => {
  const { requests, baseline } = await openIdleReader(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(page, 30 * 60_000, 60_000);
  expect(requests.manifest.length).toBe(baseline);

  // The page changed while the tab was away. Coming back checks at once, quietly, and shows the new text.
  requests.setPageOverride("wiki/logistics/insurance", { content: "# Insurance\n\nUPDATED WHILE AWAY." });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests.manifest.length).toBeGreaterThan(baseline);
  await expect(documentArticle(page)).toContainText("UPDATED WHILE AWAY.", { timeout: 10_000 });
  expect((await statusRecord(page)).freshness).not.toContain("checking");
});

test("a check the reader asks for is shown", async ({ page }) => {
  const { requests, baseline } = await openIdleReader(page);
  requests.setManifestDelay(800);
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
  await expect(status(page)).toHaveAttribute("data-freshness", "checking");
  await page.clock.fastForward(1_000);
  await expect(status(page)).toHaveAttribute("data-freshness", "current");
  expect(requests.manifest.length).toBeGreaterThan(baseline);
});
