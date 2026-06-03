import { expect, test } from "@playwright/test";

// The mobile bottom-nav page-tree renders the shared WikiTree (the same tree the
// desktop sidebar uses). The desktop sidebar specs run at md+ widths and never
// exercise the bottom sheet, so this guards the mobile path on its own viewport.
test.describe("Mobile bottom navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("page tree renders the shared wiki tree and follows a click", async ({
    page,
  }) => {
    await page.goto("/about/Terminology", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article").first()).toBeVisible({
      timeout: 30_000,
    });

    // Open the bottom sheet from the mobile header.
    const trigger = page.getByTestId("bottom-nav-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId("bottom-nav-sheet")).toHaveAttribute(
      "data-state",
      "open",
    );

    const pageTree = page.getByTestId("bottom-nav-page-tree");

    // The top-level "wiki" section is a shared-tree directory button and starts
    // open for a new session (legacy default-open rule).
    const wikiSection = pageTree.getByRole("button", { name: /^wiki$/i }).first();
    await expect(wikiSection).toBeVisible();
    await expect(wikiSection).toHaveAttribute("aria-expanded", "true");

    // Following an in-tree page link navigates and closes the sheet.
    const firstPageLink = pageTree.locator('a[href^="/wiki/"]').first();
    await expect(firstPageLink).toBeVisible();
    const href = await firstPageLink.getAttribute("href");
    await firstPageLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByTestId("bottom-nav-sheet")).toHaveAttribute(
      "data-state",
      "closed",
    );
  });
});
