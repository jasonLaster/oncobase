import { expect, test, type Page } from "@playwright/test";

const IMAGE_PAGE =
  "/sources/research/papers/cancer-vaccines/cleveland-clinic-2025-alpha-lactalbumin-phase1-final";
const isProdRun = process.env.TEST_ENV === "prod";

async function openFirstTheaterImage(page: Page) {
  const image = page.locator(".prose img[data-theater-image]").first();

  await expect(image).toHaveCount(1, { timeout: 15_000 });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible({ timeout: 15_000 });
  await image.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  return dialog;
}

test.describe("Image theater", () => {
  test.skip(
    isProdRun,
    "Image theater assertions depend on a specific deployed markdown image fixture."
  );

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
      /3f641eb4ab6c367340c58be37a335e11_MD5\.avif/
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
