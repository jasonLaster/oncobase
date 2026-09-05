import { test, expect, article, signIn, openReader, checkpoint, readerPath } from "./fixtures";

const comparisonPath = "/tools/dicom-compare?comparison=mri-comparison-2026-07-17-vs-2026-08-24";

test("desktop reader and table controls", async ({ page }, info) => {
  await openReader(page);
  await checkpoint(page, info, "01-reader-loaded");
  await article(page).getByRole("button", { name: "Expand table" }).first().click();
  await expect(page.getByRole("button", { name: "Collapse table" }).first()).toBeVisible();
  await checkpoint(page, info, "02-table-expanded");
  await page.getByRole("button", { name: "Collapse table" }).first().click();
  await expect(article(page).getByRole("button", { name: "Expand table" }).first()).toBeVisible();
  await checkpoint(page, info, "03-table-collapsed");
});

test("mobile reader navigation and outline", async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openReader(page);
  await checkpoint(page, info, "01-mobile-reader");
  await page.getByTestId("bottom-nav-trigger").click();
  const sheet = page.getByTestId("bottom-nav-sheet");
  await expect(sheet).toHaveCSS("opacity", "1");
  await expect(sheet).toHaveCSS("pointer-events", "auto");
  await checkpoint(page, info, "02-page-navigation");
  await sheet.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(sheet.getByText("Sources", { exact: true })).toBeVisible();
  await checkpoint(page, info, "03-outline");
  await sheet.getByRole("button", { name: "Close navigation" }).click();
  // Both hosts animate the sheet out instead of removing its layout box.
  await expect(sheet).toHaveCSS("opacity", "0");
  await expect(sheet).toHaveCSS("pointer-events", "none");
});

test("public terms and password deep-link gate", async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/terms-and-conditions/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Terms and Conditions", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/terms-and-conditions$/);
  await checkpoint(page, info, "01-public-terms");
  await page.goto(readerPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeVisible();
  await checkpoint(page, info, "02-password-gate");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD!);
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${readerPath}$`));
  await expect(article(page).getByRole("heading", { level: 1 })).toBeVisible();
  await expect(article(page).getByRole("table").first()).toBeVisible();
  await checkpoint(page, info, "03-restored-deep-link");
});

for (const width of [1440, 393]) {
  test(`text search and result navigation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    await signIn(page);
    await page.goto("/search?q=terminology&tab=text", { waitUntil: "domcontentloaded" });
    const results = page.getByTestId("search-text-result");
    await expect(results.first()).toBeVisible();
    await expect(page.getByTestId("search-text-summary")).not.toContainText("full results loading");
    await checkpoint(page, info, "01-text-search-results");
    await results.first().click();
    await expect(article(page).getByRole("heading", { level: 1 })).toBeVisible();
    await expect(article(page).locator("p").first()).toBeVisible();
    await checkpoint(page, info, "02-selected-article");
    await page.goBack();
    await expect(results.first()).toBeVisible();
    await expect(page.getByTestId("search-text-summary")).not.toContainText("full results loading");
    await checkpoint(page, info, "03-restored-search");
  });
}

for (const width of [1440, 393]) {
  test(`calculator edit and URL restoration at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    await signIn(page);
    await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });
    const agi = page.getByRole("textbox", { name: "Adjusted Gross Income (AGI)", exact: true });
    const medical = page.getByRole("textbox", { name: "Qualified Medical Expenses", exact: true });
    await expect(agi).toBeVisible();
    await checkpoint(page, info, "01-calculator-default");
    await agi.fill("900000");
    await agi.press("Enter");
    await medical.fill("1000000");
    await medical.press("Enter");
    await expect(page.getByTestId("medical-deduction-summary")).toContainText("$320,169");
    await expect.poll(() => new URL(page.url()).searchParams.get("agi")).toBe("900000");
    await checkpoint(page, info, "02-calculator-edited");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(agi).toHaveValue("900,000");
    await expect(medical).toHaveValue("1,000,000");
    await expect(page.getByTestId("medical-deduction-summary")).toContainText("$320,169");
    await checkpoint(page, info, "03-calculator-reloaded");
  });
}

test("tablet paired imaging controls and reload", async ({ page }, info) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  await signIn(page);
  await page.goto(comparisonPath, { waitUntil: "domcontentloaded" });
  for (const side of ["left", "right"]) {
    const canvas = page.getByTestId(`dicom-compare-${side}-viewport`).locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
    expect((await canvas.boundingBox())!.height).toBeGreaterThanOrEqual(200);
  }
  await checkpoint(page, info, "01-paired-images-loaded");
  const counter = page.getByTestId("dicom-compare-left-counter");
  const before = await counter.innerText();
  await page.getByRole("button", { name: "Next matched slice" }).click();
  await expect(counter).not.toHaveText(before);
  for (const side of ["left", "right"]) {
    await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
  }
  await checkpoint(page, info, "02-next-matched-slice");
  await page.reload({ waitUntil: "domcontentloaded" });
  // Both hosts reopen the configured default slice; comparison URLs do not
  // currently persist the slice selected by these controls.
  await expect(counter).toHaveText(before);
  for (const side of ["left", "right"]) {
    await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
  }
  await checkpoint(page, info, "03-paired-images-reloaded");
});
