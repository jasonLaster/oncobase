import { expect, test, type Page } from "@playwright/test";

const IMAGE_PAGE = "/wiki/education/serova-meeting-prep";

async function openFirstTheaterImage(page: Page) {
  const image = page
    .locator(".prose img[data-theater-image]")
    .filter({ visible: true })
    .first();

  await expect(image).toBeVisible({ timeout: 15_000 });
  await image.click();

  const dialog = page.getByRole("dialog", { name: /cartoon|image preview/i });
  await expect(dialog).toBeVisible();

  return dialog;
}

test.describe("Image theater", () => {
  test("opens markdown images with download and closes on the first mask or close-button click", async ({
    page,
  }) => {
    const response = await page.goto(IMAGE_PAGE);
    test.skip(
      response?.status() === 404,
      "The local/dev content seed does not include the Serova image fixture."
    );

    let dialog = await openFirstTheaterImage(page);

    await expect(page.getByRole("link", { name: "Download image" })).toHaveAttribute(
      "download",
      /tissue-first-vs-blood-first-light\.png/
    );

    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();

    await page.mouse.click(dialogBox!.x + 20, dialogBox!.y + dialogBox!.height - 20);
    await expect(dialog).toBeHidden();

    dialog = await openFirstTheaterImage(page);
    await page.getByRole("button", { name: "Close image preview" }).click();
    await expect(dialog).toBeHidden();

    dialog = await openFirstTheaterImage(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
