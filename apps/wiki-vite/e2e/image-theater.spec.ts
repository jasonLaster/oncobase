import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

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
});
