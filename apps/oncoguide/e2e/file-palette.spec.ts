import { expect, test } from "@playwright/test";

const dna = "/education/molecular-profiling/01-dna-the-blueprint/";
const autophagy = "/education/molecular-profiling/evee-pathways/01-autophagy-and-proteostasis/";

for (const shortcut of ["Meta+k", "Control+k"]) {
  test(`${shortcut} opens the file palette across education routes`, async ({ page }) => {
    for (const route of ["/", dna, dna.replace("/education/", "/wiki/education/"), "/education/chat/", "/education/search/?q=dna"]) {
      await page.goto(route);
      const trigger = page.getByRole("button", { name: "Find pages", exact: true });
      await trigger.focus();
      await page.keyboard.press(shortcut);
      const dialog = page.getByRole("dialog", { name: "Go to page" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox", { name: "Search pages" })).toBeFocused();
      await expect(dialog.getByRole("option").first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });
}

test("fuzzy search, keyboard selection and recent pages survive navigation and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Find pages", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Go to page" });
  const input = dialog.getByRole("combobox", { name: "Search pages" });
  await input.fill("autphgy proteostsis");
  const first = dialog.getByRole("option").first();
  await expect(first).toContainText("Autophagy");
  const title = await first.locator("strong").textContent();
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${autophagy}$`));
  await expect(page.getByTestId("education-article").getByRole("heading", { level: 1 })).toHaveText(title!);
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Find pages", exact: true }).focus();
  await page.keyboard.press("Control+k");
  await expect(dialog.getByText("Recent pages", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("option").first()).toContainText(title!);
  await input.fill("dna");
  await input.press("ArrowDown");
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowUp");
  await expect(dialog.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await input.fill("dna the blueprint");
  await expect(dialog.getByRole("option").first()).toContainText("DNA");
  await dialog.getByRole("option").first().click();
  await expect(page).toHaveURL(new RegExp(`${dna}$`));
  await page.keyboard.press("Control+k");
  await input.fill("zzzxxyyqqqq");
  await expect(dialog.getByText("No pages found.")).toBeVisible();
  await input.press("Enter");
  await expect(dialog).toBeVisible();
  await input.press("Escape");
  expect(errors).toEqual([]);
});

test("mobile palette supports dark theme, touch selection and backdrop dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const trigger = page.getByRole("button", { name: "Find pages", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Go to page" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await dialog.getByRole("combobox").fill("autophagy and proteostasis");
  await dialog.getByRole("option").first().click();
  await expect(page).toHaveURL(new RegExp(`${autophagy}$`));
  await trigger.click();
  await page.locator(".wiki-shell-command-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
