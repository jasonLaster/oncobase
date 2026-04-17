import { expect, test } from "@playwright/test";

test.describe("Markdown heading anchors", () => {
  test("clicking a markdown heading updates the URL hash", async ({ page }) => {
    await page.goto("/table-examples");

    const heading = page.locator(".prose h2[id]").first();
    await expect(heading).toBeVisible();

    const id = await heading.getAttribute("id");
    if (!id) {
      throw new Error("Expected markdown heading to have an id attribute");
    }

    await heading.click();

    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(heading).toHaveClass(/cursor-pointer/);
    await expect(heading.locator(".heading-anchor")).toBeVisible();
  });
});
