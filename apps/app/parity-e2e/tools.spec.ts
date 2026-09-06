import { exampleTables } from "@oncobase/smart-table/examples";
import { test, expect, signIn, checkpoint } from "./fixtures";

for (const width of [393, 1440]) {
  test(`calculator clamping, keyboard grid and complete four-year URL at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    await page.goto("/tools/medical-deduction");
    const agi = page.getByRole("textbox", { name: "Adjusted Gross Income (AGI)", exact: true });
    const medical = page.getByRole("textbox", { name: "Qualified Medical Expenses", exact: true });
    const summary = page.getByTestId("medical-deduction-summary");
    await expect(summary).toContainText("$33,985");
    await medical.fill("-1"); await medical.press("Enter");
    await expect(medical).toHaveValue("0");
    await expect(summary).toContainText("Net cost after savings: $0");
    await medical.fill("9999999"); await medical.press("Enter");
    await expect(medical).toHaveValue("2,000,000");
    const cell = page.getByRole("button", { name: /AGI \$900,000, medical \$1,000,000, estimated tax savings \$320,169/ });
    await cell.focus(); await cell.press("Enter");
    await expect(agi).toHaveValue("900,000");
    await expect(medical).toHaveValue("1,000,000");
    await checkpoint(page, info, "keyboard-grid-selection");
    await page.getByLabel("Spread costs across multiple tax years").check();
    await page.getByRole("button", { name: "4", exact: true }).click();
    await page.getByLabel("Customize distribution").check();
    await page.getByRole("spinbutton", { name: "AGI", exact: true }).first().fill("800000");
    await page.getByRole("spinbutton", { name: "Medical spend", exact: true }).first().fill("400000");
    await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
      agi: "900000", medical: "1000000", spread: "1", years: "4", customize: "1", year1Agi: "800000", year1Medical: "400000",
    });
    await checkpoint(page, info, "custom-four-year-plan");
    await page.reload();
    await expect(page.getByLabel("Customize distribution")).toBeChecked();
    await expect(page.getByText("Year 4", { exact: true })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "AGI", exact: true }).first()).toHaveValue("800000");
    await expect(page.getByRole("spinbutton", { name: "Medical spend", exact: true }).first()).toHaveValue("400000");
    await checkpoint(page, info, "restored-four-year-plan");
  });
}

for (const example of exampleTables) {
  test(`table example ${example.id} expands, collapses and survives mobile resize`, async ({ page }, info) => {
    await signIn(page);
    await page.goto("/table-examples");
    const heading = page.getByRole("heading", { name: example.title, level: 2 });
    const shell = heading.locator("xpath=following-sibling::div[@data-smart-table-shell][1]");
    const expand = shell.getByRole("button", { name: "Expand table" });
    await expect(expand).toBeVisible();
    await heading.scrollIntoViewIfNeeded();
    await checkpoint(page, info, "table-collapsed");
    await expand.click();
    const collapse = page.getByRole("button", { name: "Collapse table" });
    await expect(collapse).toBeVisible();
    const expanded = page.locator(".table-expansion-layer");
    expect((await expanded.boundingBox())!.width).toBeGreaterThan(300);
    await checkpoint(page, info, "table-expanded");
    await collapse.click();
    await expect(expand).toBeVisible();
    await expand.click();
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(expanded).toHaveCount(0);
    await expect(shell.getByRole("table")).toBeVisible();
    await checkpoint(page, info, "mobile-in-flow");
  });
}

for (const width of [393, 820, 1440]) {
  test(`diagnostics timeline and imaging entry at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    await page.goto("/diagnostics");
    await expect(page.getByRole("heading", { name: "Diagnostics", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByTestId(width < 768 ? "mobile-diagnostic-timeline" : "timeline-sticky-header")).toBeVisible();
    await checkpoint(page, info, "diagnostics-timeline");
    await page.getByRole("link", { name: "Imaging", exact: true }).first().click();
    await expect(page).toHaveURL(/\/diagnostics\/imaging$/);
    await expect(page.locator('a[href*="/tools/dicom-viewer"]').filter({ visible: true }).first()).toBeVisible();
    await checkpoint(page, info, "imaging-list");
  });
}

test("diagnostic timeline zoom, reset and track synchronization", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/diagnostics");
  const timeline = page.getByTestId("diagnostic-timeline");
  await expect(timeline).toHaveAttribute("data-visible-range", /\d{4}-\d{2}-\d{2}:/);
  const before = await timeline.getAttribute("data-visible-range");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(timeline).not.toHaveAttribute("data-visible-range", before!);
  await checkpoint(page, info, "timeline-zoomed");
  await page.getByRole("button", { name: "Reset timeline range", exact: true }).click();
  await expect(timeline).toHaveAttribute("data-visible-range", before!);
  await checkpoint(page, info, "timeline-reset");
});
