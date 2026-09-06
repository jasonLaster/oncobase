import { test, expect, openReader, signIn, article, checkpoint, modifier, readerPath } from "./fixtures";

for (const width of [393, 767, 768, 1023, 1024, 1440, 1920]) {
  test(`reader reflow and loaded content at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page);
    const mobileHeader = page.getByTestId("mobile-page-header");
    if (width < 768) await expect(mobileHeader).toBeVisible();
    else await expect(mobileHeader).toBeHidden();
    await expect(article(page).getByRole("table").first()).toBeVisible();
    const bounds = (await article(page).boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(Math.min(width - 40, 320));
    await checkpoint(page, info, "reader");
  });
}

for (const width of [393, 1440]) {
  test(`file palette keyboard selection, empty state and history at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page);
    await page.keyboard.press(`${modifier}+K`);
    const input = page.getByRole("combobox", { name: "Search pages" });
    await expect(input).toBeFocused();
    await input.fill("zzzznonexistentquery999");
    await expect(page.getByText("No pages found.")).toBeVisible();
    await checkpoint(page, info, "file-empty");
    await input.fill("about/Terminology");
    const option = page.getByRole("option").filter({ hasText: "Terminology" }).first();
    await expect(option).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const active = await input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
    await checkpoint(page, info, "file-selected");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/about\/Terminology$/);
    await expect(article(page).getByRole("heading", { level: 1 })).toContainText("Terminology");
    await checkpoint(page, info, "destination");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${readerPath}$`));
    await expect(article(page).getByRole("heading", { level: 1 })).toContainText("Insurance");
  });

  test(`heading anchors survive reload and clear fixed chrome at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page, "/about/Terminology#brca");
    const heading = article(page).locator('[id="brca"]');
    await expect(heading).toBeInViewport();
    await checkpoint(page, info, "anchor-loaded");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(heading).toBeInViewport();
    const header = page.getByTestId("mobile-page-header");
    const headerBottom = width < 768 ? await header.evaluate((element) => element.getBoundingClientRect().bottom) : 0;
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom - 1);
    await checkpoint(page, info, "anchor-reloaded");
  });

  test(`dark theme persists across reload at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page);
    // Theme is an actual workspace command, not a forced DOM class.
    await page.keyboard.press(`${modifier}+K`);
    await page.keyboard.press("A");
    const input = page.getByRole("dialog").getByRole("combobox");
    await expect(input).toHaveAttribute("placeholder", /Search commands/);
    await input.fill("dark");
    await page.getByRole("dialog").getByText("Switch to Dark theme", { exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await checkpoint(page, info, "dark-reader");
    await page.keyboard.press(`${modifier}+K`);
    await expect(page.getByRole("combobox", { name: "Search pages" })).toBeVisible();
    await checkpoint(page, info, "dark-palette");
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(article(page).getByRole("table").first()).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await checkpoint(page, info, "dark-reloaded");
  });
}

for (const [key, placeholder] of [["O", /heading/i], ["A", /Search commands/]] as const) {
  test(`command chord K then ${key}`, async ({ page }, info) => {
    await openReader(page);
    await page.keyboard.press(`${modifier}+K`);
    await page.keyboard.press(key);
    await expect(page.getByRole("dialog").getByRole("combobox")).toHaveAttribute("placeholder", placeholder);
    await checkpoint(page, info, "chord-open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
}

test("mobile navigation traps and restores keyboard focus", async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openReader(page);
  const trigger = page.getByTestId("bottom-nav-trigger");
  await trigger.click();
  const sheet = page.getByTestId("bottom-nav-sheet");
  await expect(sheet.getByRole("button", { name: "Close navigation" })).toBeFocused();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await checkpoint(page, info, "focus-trapped");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCSS("opacity", "0");
  await expect(trigger).toBeFocused();
});

test("workspace actions expose downloads and restore focus", async ({ page }, info) => {
  await openReader(page);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Workspace menu" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Actions" });
  for (const [label, type] of [["full", "full"], ["markdown", "markdown"]]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`Download wiki \\(${label}\\)`) }))
      .toHaveAttribute("href", new RegExp(`/api/download\\?type=${type}`));
  }
  await checkpoint(page, info, "workspace-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("unknown article renders an actionable not-found state", async ({ page }, info) => {
  await openReader(page);
  await page.goto("/wiki/parity-page-that-does-not-exist-93871");
  await expect(page.getByText(/page not found|page could not be found/i).first()).toBeVisible();
  await checkpoint(page, info, "not-found");
  await page.goBack();
  await expect(article(page).getByRole("table").first()).toBeVisible();
});
