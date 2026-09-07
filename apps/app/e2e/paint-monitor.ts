import { expect, type Page, type TestInfo } from "@playwright/test";

/** Observe actual frame candidates, including CSS hiding, before application JS runs.
 * DOM mutations alone would flag harmless React replacements between paints.
 * Start a new monitor/document when intentionally navigating to different content.
 */
export async function installPaintMonitor(page: Page) {
  await page.addInitScript(() => {
    const selectors = {
      heading: '[data-test-id="document-article"] .page-header h1',
      body: '[data-test-id="document-article"] .wiki-markdown',
      navigation: '[data-test-id="wiki-sidebar"]',
      commentsLink: '[data-test-id="wiki-sidebar"] a[href="/comments"]',
      diagnosticsLink: '[data-test-id="wiki-sidebar"] a[href^="/diagnostics"]',
      rightRail: '[data-wiki-shell-right-rail]',
    };
    type Box = { x: number; width: number };
    const state = {
      frames: 0,
      seen: {} as Record<string, Box>,
      violations: [] as Array<{ frame: number; region: string; reason: string }>,
      changes: [] as Array<{ frame: number; visible: string[] }>,
    };
    (window as unknown as { paintMonitor: typeof state }).paintMonitor = state;
    let previous = "";
    function sample() {
      state.frames++;
      const visible: string[] = [];
      for (const [region, selector] of Object.entries(selectors)) {
        // During snapshot handoff both trees exist; the first match may be hidden.
        const element = [...document.querySelectorAll<HTMLElement>(selector)].find((node) =>
          node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
          node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
        );
        const box = element?.getBoundingClientRect();
        const painted = element && box && box.width > 0 && box.height > 0 &&
          element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        if (painted) {
          visible.push(region);
          const first = state.seen[region];
          if (first && ["navigation", "rightRail"].includes(region) &&
            (Math.abs(first.width - box.width) > 1 || Math.abs(first.x - box.x) > 1)) {
            record(region, `geometry changed from ${JSON.stringify(first)} to ${JSON.stringify({ x: box.x, width: box.width })}`);
          }
          state.seen[region] ??= { x: box.x, width: box.width };
        } else if (state.seen[region]) {
          record(region, "disappeared after being painted");
        }
      }
      const signature = visible.join(",");
      if (signature !== previous) {
        state.changes.push({ frame: state.frames, visible });
        previous = signature;
      }
      requestAnimationFrame(sample);
    }
    function record(region: string, reason: string) {
      if (!state.violations.some((item) => item.region === region && item.reason === reason)) {
        state.violations.push({ frame: state.frames, region, reason });
      }
    }
    requestAnimationFrame(sample);
  });
}

export async function assertAdditivePaint(page: Page, testInfo: TestInfo, mobile = false) {
  const state = await page.evaluate(() =>
    (window as unknown as { paintMonitor: {
      frames: number; seen: Record<string, unknown>; violations: unknown[];
    } }).paintMonitor,
  );
  await testInfo.attach("paint-history", {
    body: JSON.stringify(state, null, 2), contentType: "application/json",
  });
  expect(state.frames).toBeGreaterThan(1);
  // Avoid vacuous passes when selectors drift or the app never loads.
  for (const region of mobile ? ["heading", "body"] : ["heading", "body", "navigation", "commentsLink", "diagnosticsLink", "rightRail"]) {
    expect(state.seen, `No paint recorded for ${region}`).toHaveProperty(region);
  }
  expect(state.violations, "Already-painted content must remain visible and rails must keep their geometry").toEqual([]);
}
