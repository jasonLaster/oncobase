import { expect, test } from "@playwright/test";
import { ensurePasswordGateSession } from "./gate-auth";

// Read-only published comparison: this also runs against the deployed candidate,
// unlike the dynamic-metadata suite that requires a local seeded study set.
const comparisonPath = "/tools/dicom-compare?comparison=mri-comparison-2026-07-17-vs-2026-08-24";

for (const viewport of [
  { width: 393, height: 852 },
  { width: 767, height: 852 },
  { width: 768, height: 1000 },
  { width: 820, height: 1000 },
  { width: 1023, height: 1000 },
  { width: 1024, height: 1000 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
]) {
  test(`published MRI comparison has usable canvases at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await ensurePasswordGateSession(page);
    await page.goto(comparisonPath, { waitUntil: "domcontentloaded" });

    for (const side of ["left", "right"]) {
      const canvas = page.getByTestId(`dicom-compare-${side}-viewport`).locator("canvas");
      await expect(canvas).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
      await expect(page.getByTestId(`dicom-compare-${side}-counter`)).toContainText("/ 260");
      const size = await canvas.boundingBox();
      expect(size?.width).toBeGreaterThan(150);
      expect(size?.height).toBeGreaterThanOrEqual(200);
    }

    if (!process.env.CI) {
      await testInfo.attach("loaded-comparison", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }

    // A loaded counter alone was green while both tablet canvases had zero height.
    // Exercise the controls, then ensure they do not overlap the image area.
    const leftCounter = page.getByTestId("dicom-compare-left-counter");
    const before = await leftCounter.innerText();
    const next = page.getByRole("button", { name: "Next matched slice" });
    await next.click();
    await expect(leftCounter).not.toHaveText(before);
    const images = await page.getByTestId("dicom-compare-viewports").boundingBox();
    const control = await next.boundingBox();
    expect(control!.y).toBeGreaterThanOrEqual(images!.y + images!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
