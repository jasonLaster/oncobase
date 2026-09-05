import axe from "axe-core";
import { test, expect, signIn, openReader, checkpoint } from "./fixtures";

for (const width of [393, 1440]) {
  for (const route of ["/wiki/logistics/insurance", "/search", "/tools/medical-deduction", "/terms-and-conditions"]) {
    test(`accessible ${route} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await signIn(page);
      if (route.startsWith("/wiki/")) await openReader(page, route);
      else {
        await page.goto(route);
        await expect(page.locator(route === "/search" ? 'input[data-test-id="search-form-input"]' : "h1").filter({ visible: true }).first()).toBeVisible();
      }
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const { violations } = await (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        });
        return violations.filter((v) => v.impact === "serious" || v.impact === "critical")
          .map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }));
      });
      await info.attach("accessibility", { body: JSON.stringify(violations, null, 2), contentType: "application/json" });
      await checkpoint(page, info, "accessibility-surface");
      expect(violations).toEqual([]);
    });
  }

  test(`chat draft, archived navigation and history at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    await page.goto("/chat");
    const composer = page.getByTestId("chat-composer-textarea");
    await expect(composer).toBeVisible();
    await composer.fill("Unsent parity draft — do not submit");
    await expect(composer).toHaveValue("Unsent parity draft — do not submit");
    await checkpoint(page, info, "unsent-chat-draft");
    if (width < 768) {
      await page.getByTestId("bottom-nav-trigger").click();
      await expect(page.getByTestId("bottom-nav-sheet")).toHaveCSS("opacity", "1");
    } else {
      await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    }
    await page.getByTestId("conversation-list-archived").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/chat\/archived$/);
    await expect(page.getByText("Archived Chats", { exact: true }).first()).toBeVisible();
    await checkpoint(page, info, "archived-chat-list");
    await page.goBack();
    await expect(composer).toBeVisible();
  });
}
