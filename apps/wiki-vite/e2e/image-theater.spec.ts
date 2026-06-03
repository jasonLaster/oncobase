import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

test.describe("Image theater", () => {
  test("opens markdown images with download and closes from mask and close button", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/media/image-theater");

    const imageButton = page.getByRole("button", { name: "Open image: Pathology slide" });
    await expect(imageButton).toBeVisible();
    await imageButton.click();

    const dialog = page.getByRole("dialog", { name: "Pathology slide" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("link", { name: "Download image" })).toHaveAttribute(
      "href",
      /\/api\/file\?path=(sources%2Fimages%2Fpathology-slide|sources\/images\/pathology-slide)\.png/,
    );

    await page.getByRole("button", { name: "Close image preview" }).click();
    await expect(dialog).toBeHidden();

    await imageButton.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("renders light/dark theme-pair images toggled by the active theme", async ({ page }) => {
    await installWikiApiMocks(page, {
      pageOverrides: {
        "wiki/media/theme-pair": {
          title: "Theme Pair",
          tags: ["media"],
          content:
            '# Theme Pair\n\n<img data-theme-pair src="/api/file?path=sources/images/diagram-light.png" alt="Theme diagram" />\n',
        },
      },
    });
    await gotoWiki(page, "/wiki/media/theme-pair");

    // Both variants are rendered; the toggle is driven by the `.dark` class.
    const images = documentArticle(page).locator('img[alt="Theme diagram"]');
    await expect(images).toHaveCount(2);
    await expect(images.nth(0)).toHaveAttribute("src", /diagram-light\.png/);
    await expect(images.nth(1)).toHaveAttribute("src", /diagram-dark\.png/);

    // Default theme is light: light variant visible, dark variant hidden.
    await expect(images.nth(0)).toBeVisible();
    await expect(images.nth(1)).toBeHidden();
  });
});
