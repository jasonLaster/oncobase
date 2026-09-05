import { expect, signIn, checkpoint, modifier } from "./fixtures";
import { test } from "./annotation-backend";

for (const viewport of [
  { width: 393, height: 852 }, { width: 767, height: 852 },
  { width: 768, height: 1000 }, { width: 820, height: 1000 },
  { width: 1023, height: 1000 }, { width: 1024, height: 1000 },
  { width: 1440, height: 1000 }, { width: 1920, height: 1080 }, { width: 844, height: 390 },
]) {
  test(`decoded comparison and controls at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await page.goto("/tools/dicom-compare?comparison=mri-comparison-2026-07-17-vs-2026-08-24");
    for (const side of ["left", "right"]) {
      const canvas = page.getByTestId(`dicom-compare-${side}-viewport`).locator("canvas");
      await expect(canvas).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
      const bounds = (await canvas.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(150); expect(bounds.height).toBeGreaterThanOrEqual(200);
    }
    const workspace = (await page.getByTestId("dicom-comparison").boundingBox())!;
    expect(workspace.y).toBe(0);
    expect(workspace.height, "Immersive imaging must not reserve space for absent reader chrome").toBe(viewport.height);
    await checkpoint(page, info, "decoded-images");
    const counter = page.getByTestId("dicom-compare-left-counter");
    const before = await counter.innerText();
    await page.getByRole("button", { name: "Next matched slice" }).click();
    await expect(counter).not.toHaveText(before);
    for (const side of ["left", "right"]) {
      await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
    }
    await checkpoint(page, info, "next-matched-slice");
    for (const label of ["Pan", "Zoom", "W/L"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
  });
}

test("image annotations edit, delete, undo and reload through the real backend", async ({ page, annotationBackend }, info) => {
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dicom/annotations"
    && new URL(response.url()).searchParams.get("seriesKey") === annotationBackend.seriesKey);
  await page.goto(`/tools/dicom-viewer?id=biopsy-2026-04-10&seriesId=${annotationBackend.seriesKey}&image=1`);
  // Do not draw until the actual UI has requested our owned namespace.
  expect((await loaded).ok()).toBe(true);
  await expect(page.getByTestId("dicom-cornerstone-viewport").locator("canvas")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 45_000 });
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const bounds = (await page.getByTestId("dicom-annotation-canvas").boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.56, bounds.y + bounds.height * 0.5);
  await page.mouse.up();
  const shape = page.getByTestId("dicom-annotation-shape-text");
  await expect(shape).toBeVisible();
  await page.getByTestId("dicom-annotation-inline-text").fill("Synthetic parity annotation");
  await expect(shape).toContainText("Synthetic parity annotation");
  await expect.poll(async () => JSON.stringify(await annotationBackend.read())).toContain("Synthetic parity annotation");
  await checkpoint(page, info, "annotation-edited");
  await page.getByTestId("dicom-annotation-inline-text").blur();
  await page.keyboard.press("Backspace");
  await expect(shape).toHaveCount(0);
  await expect.poll(async () => (await annotationBackend.read()).flatMap((image) => image.annotations).length).toBe(0);
  await page.keyboard.press(`${modifier}+Z`);
  await expect(shape).toContainText("Synthetic parity annotation");
  await expect.poll(async () => JSON.stringify(await annotationBackend.read())).toContain("Synthetic parity annotation");
  await checkpoint(page, info, "annotation-undo");
  await page.reload();
  await expect(shape).toContainText("Synthetic parity annotation");
  await expect(page.getByTestId("dicom-cornerstone-viewport").locator("canvas")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 45_000 });
  await expect(page.getByTestId("dicom-slice-counter")).toHaveText("1 / 1");
  await checkpoint(page, info, "annotation-reloaded");
});

for (const width of [393, 1440]) {
  test(`single viewer slice URL, reload and tools at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    await page.goto("/tools/dicom-viewer?id=biopsy-2026-04-10&image=6");
    await expect(page.getByTestId("dicom-cornerstone-viewport").locator("canvas")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 45_000 });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9");
    await checkpoint(page, info, "single-image-loaded");
    await page.getByRole("button", { name: "Previous image", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("image")).toBe("5");
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 45_000 });
    await page.reload();
    await expect(page.getByTestId("dicom-cornerstone-viewport").locator("canvas")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9");
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 45_000 });
    await checkpoint(page, info, "single-image-restored");
  });
}
