import { test, expect } from "@playwright/test";

// Desktop sidebar locator
const sidebar = "aside.hidden.md\\:flex nav";

test.describe("Page viewing & sidebar navigation", () => {
  test("home page loads with wiki content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("article").first()).toBeVisible();
    const nav = page.locator(sidebar);
    await expect(
      nav.getByRole("button", { name: /^(▼|▶) sources$/ })
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: /^(▼|▶) wiki$/ })
    ).toBeVisible();
  });

  test("navigate to a page via sidebar", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    // Click a top-level file link visible without expanding (e.g., "index" or "Journal")
    await nav.getByRole("link", { name: "Journal" }).click();
    await expect(page).toHaveURL(/\/about\/Journal/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("redirects mixed-case wiki paths to canonical casing", async ({ page }) => {
    await page.goto("/about/index");
    await expect(page).toHaveURL(/\/about\/Index$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("page shows tags and copy button", async ({ page }) => {
    await page.goto("/wiki/diagnostics/diagnosis");
    await expect(page.locator("h1").first()).toContainText("Diagnosis");
    await expect(page.getByRole("link", { name: "TNBC" }).first()).toBeVisible();
    await expect(
      page.locator('button[aria-label="Copy page as markdown"]').first()
    ).toBeVisible();
  });

  test("actions menu opens with theme and download", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[aria-label="Actions"]').click();
    await expect(page.getByRole("menuitem", { name: "Theme: System" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download wiki (full)" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download wiki (markdown)" })).toBeVisible();
  });

  test("command palette opens with Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await expect(
      page.locator('[role="dialog"] [role="combobox"]').first()
    ).toBeVisible();
  });
});
