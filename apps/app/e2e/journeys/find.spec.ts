import { expect, test } from "@playwright/test";
import { article, modKey, openPage, passGate, requireLocalStack } from "./helpers";

// AI-mode ranking needs embeddings, which the local stack does not configure; it
// is covered at the API boundary by the contract tier.
requireLocalStack();

test.describe("finding things (real backend)", () => {
  test.beforeEach(async ({ page }) => passGate(page));

  test("the palette opens from the keyboard, filters pages, opens one with Enter, and restores focus on Escape", async ({ page }) => {
    await openPage(page, "/");
    await page.keyboard.press(`${modKey}+k`);
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();

    await input.fill("biomarkers");
    await expect(page.getByRole("option").first()).toContainText(/biomarkers/i);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/wiki\/biomarkers\/index$/);
    await expect(article(page)).toHaveAccessibleName("Biomarkers");

    await page.keyboard.press(`${modKey}+k`);
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("arrow keys move the palette selection and a no-match query says so", async ({ page }) => {
    await openPage(page, "/");
    await page.getByTestId("sidebar-search").click();
    const input = page.getByTestId("command-palette-input");
    await input.fill("t");
    const options = page.getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

    await input.fill("zzzzqqqq");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText(/No pages found/);
  });

  test("text search shows snippets for the query and opens the matching page", async ({ page }) => {
    await page.goto("/search?q=lumpectomy");
    await page.getByRole("button", { name: "Text Search" }).click();
    await expect(page.getByTestId("search-text-summary")).toBeVisible();
    await expect(page.getByTestId("search-text-file").filter({ hasText: /treatment/ })).toBeVisible();
    const hit = page.getByTestId("search-text-result").filter({ hasText: /lumpectomy/i }).first();
    await expect(hit).toBeVisible();

    await hit.click();
    await expect(page).toHaveURL(/\/wiki\/treatment/);
    await expect(article(page)).toHaveAccessibleName("Treatment notes");
  });

  test("searching from the search page updates the URL and results, and a miss shows an empty state", async ({ page }) => {
    await page.goto("/search?q=carboplatin");
    await page.getByRole("button", { name: "Text Search" }).click();
    const input = page.getByTestId("search-form-input");
    await expect(page.getByTestId("search-text-summary")).toBeVisible();
    await input.fill("pembrolizumab");
    await input.press("Enter");
    await expect(page).toHaveURL(/q=pembrolizumab/);
    // The previous query's summary is still on screen: wait for the new results.
    await expect(page.getByTestId("search-text-result").first()).toContainText(/pembrolizumab/i);

    await input.fill("zzzzqqqq");
    await input.press("Enter");
    await expect(page.getByTestId("search-text-empty")).toBeVisible();
  });

  test("a text-search result can be opened from the keyboard", async ({ page }) => {
    await page.goto("/search?q=pembrolizumab");
    await page.getByRole("button", { name: "Text Search" }).click();
    const first = page.getByTestId("search-text-result").first();
    await expect(first).toBeVisible();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/search/);
    await expect(article(page)).toBeVisible();
  });
});
