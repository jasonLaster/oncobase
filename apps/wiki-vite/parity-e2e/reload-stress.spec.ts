import { test, expect, openReader, article, checkpoint, modifier } from "./fixtures";

for (const width of [393, 1440]) {
  test(`reader remains interactive across rapid reloads at ${width}px`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page, "/about/Terminology#brca");
    for (let cycle = 0; cycle < 10; cycle++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("#wiki-first-frame-snapshot").filter({ visible: true })).toHaveCount(0);
      await expect(article(page).locator('[id="brca"]')).toBeInViewport();
      // Cached HTML alone cannot satisfy a working keyboard command.
      await page.keyboard.press(`${modifier}+K`);
      await expect(page.getByRole("combobox", { name: "Search pages" })).toBeFocused();
      await page.keyboard.press("Escape");
    }
    await checkpoint(page, info, "ten-reloads-interactive");
  });
}

test("heading links appear on hover and keyboard focus while prose links remain underlined", async ({ page }, info) => {
  await openReader(page);
  const heading = article(page).locator(".wiki-heading-group").first();
  const link = heading.locator(".heading-anchor");
  await page.mouse.move(0, 0);
  await expect(link).toHaveCSS("opacity", "0");
  await heading.hover();
  await expect(link).toHaveCSS("opacity", "1");
  await expect(link).toHaveCSS("text-decoration-line", "none");
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await link.focus();
  await expect(link).toHaveCSS("opacity", "1");
  await checkpoint(page, info, "heading-link-focus");
  await expect(article(page).locator('.wiki-markdown p a:not(.heading-anchor)').first()).toHaveCSS("text-decoration-line", "underline");
});
