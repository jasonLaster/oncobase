import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const routes = ["/about/Index", "/diagnostics", "/diagnostics/imaging"];

test.describe("@smoke accessibility", () => {
  for (const route of routes) {
    test(`${route} has no serious or critical WCAG violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.locator("body")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      const summary = blocking.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.flatMap((node) => node.target),
      }));

      expect(summary, `accessibility violations on ${route}`).toEqual([]);
    });
  }
});
