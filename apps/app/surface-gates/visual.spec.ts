/**
 * Visual baselines: one screenshot per surface x theme x viewport.
 *
 * Baselines live in __screenshots__/linux and are rendered in the official Playwright image
 * (`bun run surfaces:update`), which CI also uses, so fonts match. In CI this spec is
 * report-only: diffs are uploaded for review but do not fail the job.
 */
import { expect, test, type Page } from "@playwright/test";
import { surfaceCases } from "./surfaces";
import { newSurfaceContext, openSurface } from "./support";

/** Regions that change between runs for reasons unrelated to the UI under test. */
const DYNAMIC_MASKS = [
  ".metrics-panel",
  ".topbar-status",
  ".page-footer",
  // The sidebar's transient "Checking…" freshness label; the "Pages" heading stays visible.
  ".reader-navigation-transfer",
];

const masks = (page: Page, extra: string[] = []) => [...DYNAMIC_MASKS, ...extra].map((selector) => page.locator(selector));

for (const { surface, theme, viewport, key } of surfaceCases()) {
  test(`visual ${key}`, async ({ browser }) => {
    const context = await newSurfaceContext(browser, { auth: surface.auth, theme, viewport });
    try {
      const page = await context.newPage();
      await openSurface(page, surface);
      await expect(page).toHaveScreenshot(`${key}.png`, { mask: masks(page, surface.masks) });
    } finally {
      await context.close();
    }
  });
}
