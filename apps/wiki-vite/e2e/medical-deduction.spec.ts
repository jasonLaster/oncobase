import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

const agiInputName = "Adjusted Gross Income (AGI)";
const medicalInputName = "Qualified Medical Expenses";

test("an edit at the calculator's first interactive commit is not overwritten by startup effects", async ({ page }) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Adjusted Gross Income (AGI)"]');
      if (!input) return;
      observer.disconnect();
      // Enter at the first DOM commit, before passive startup effects. Using
      // the native setter models the browser input event rather than mutating
      // React's value tracker directly.
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "900000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  await installWikiApiMocks(page);
  await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: agiInputName })).toHaveValue("900,000");
  await expect.poll(() => new URL(page.url()).searchParams.get("agi")).toBe("900000");
});

test.describe("Medical expense deduction calculator", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
    await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });
  });

  test("updates the estimate from formatted inputs and clamps unsupported spend", async ({
    page,
  }) => {
    const summary = page.getByTestId("medical-deduction-summary");
    const agi = page.getByRole("textbox", { name: agiInputName });
    const medical = page.getByRole("textbox", { name: medicalInputName });

    await expect(summary).toContainText("$33,985");
    await expect(summary).toContainText("Net cost after savings: $116,015");

    await agi.fill("900000");
    await agi.press("Enter");
    await medical.fill("1000000");
    await medical.press("Enter");

    await expect(agi).toHaveValue("900,000");
    await expect(medical).toHaveValue("1,000,000");
    await expect(summary).toContainText("$320,169");
    await expect(summary).toContainText("Net cost after savings: $679,831");

    await medical.fill("-1");
    await medical.press("Enter");
    await expect(medical).toHaveValue("0");
    await expect(summary).toContainText("Estimated Tax Savings$0");
    await expect(summary).toContainText("Net cost after savings: $0");

    await medical.fill("9999999");
    await medical.press("Enter");
    await expect(medical).toHaveValue("2,000,000");
  });

  test("supports named sliders, keyboard grid selection, and multi-year planning", async ({
    page,
  }) => {
    await expect(page.getByRole("slider", { name: `${agiInputName} slider` })).toBeVisible();
    await expect(page.getByRole("slider", { name: `${medicalInputName} slider` })).toBeVisible();

    const sensitivityCell = page.getByRole("button", {
      name: /AGI \$900,000, medical \$1,000,000, estimated tax savings \$320,169/,
    });
    await sensitivityCell.focus();
    await sensitivityCell.press("Enter");

    await expect(page.getByRole("textbox", { name: agiInputName })).toHaveValue("900,000");
    await expect(page.getByRole("textbox", { name: medicalInputName })).toHaveValue(
      "1,000,000",
    );
    await expect(page.getByTestId("medical-deduction-summary")).toContainText("$320,169");

    const planner = page.getByTestId("medical-deduction-multi-year");
    await planner.getByLabel("Spread costs across multiple tax years").check();
    await expect(planner.getByText("Year 3", { exact: true })).toBeVisible();
    await planner.getByRole("button", { name: "4", exact: true }).click();
    await expect(planner.getByText("Year 4", { exact: true })).toBeVisible();
  });

  test("saves a complete scenario to the URL and restores it on reload", async ({ page }) => {
    const agi = page.getByRole("textbox", { name: agiInputName });
    const medical = page.getByRole("textbox", { name: medicalInputName });
    await agi.fill("900000");
    await agi.press("Enter");
    await expect(agi).toHaveValue("900,000");
    await medical.fill("1000000");
    await medical.press("Enter");
    await expect(medical).toHaveValue("1,000,000");

    const planner = page.getByTestId("medical-deduction-multi-year");
    await planner.getByLabel("Spread costs across multiple tax years").check();
    await planner.getByRole("button", { name: "4", exact: true }).click();
    await planner.getByLabel("Customize distribution").check();
    await planner.getByRole("spinbutton", { name: "AGI" }).first().fill("800000");
    await expect(planner.getByRole("spinbutton", { name: "AGI" }).first()).toHaveValue("800000");
    await planner
      .getByRole("spinbutton", { name: "Medical spend" })
      .first()
      .fill("400000");
    await expect(planner.getByRole("spinbutton", { name: "Medical spend" }).first()).toHaveValue("400000");

    await expect
      .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
      .toMatchObject({
        agi: "900000",
        medical: "1000000",
        spread: "1",
        years: "4",
        customize: "1",
        year1Agi: "800000",
        year1Medical: "400000",
      });

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByRole("textbox", { name: agiInputName })).toHaveValue("900,000");
    await expect(page.getByRole("textbox", { name: medicalInputName })).toHaveValue(
      "1,000,000",
    );
    const restoredPlanner = page.getByTestId("medical-deduction-multi-year");
    await expect(
      restoredPlanner.getByLabel("Spread costs across multiple tax years"),
    ).toBeChecked();
    await expect(restoredPlanner.getByLabel("Customize distribution")).toBeChecked();
    await expect(restoredPlanner.getByText("Year 4", { exact: true })).toBeVisible();
    await expect(restoredPlanner.getByRole("spinbutton", { name: "AGI" }).first()).toHaveValue(
      "800000",
    );
    await expect(
      restoredPlanner.getByRole("spinbutton", { name: "Medical spend" }).first(),
    ).toHaveValue("400000");
  });

  test("keeps mobile content within the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("medical-deduction-page")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      )
      .toBe(0);
    await expect(page.getByTestId("medical-deduction-summary")).toContainText("$33,985");
  });
});
