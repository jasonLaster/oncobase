import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "../fixtures";

const content = `# Drug tooltip fixture

| Trial | Treatment | Gates |
|---|---|---|
| Example | <abbr data-tooltip="drug" data-name="Atezolizumab (Tecentriq)" data-category="Checkpoint immunotherapy" data-target="PD-L1" data-effect="Immune activation" title="Blocks PD-L1, helping T cells attack cancer.">atezolizumab</abbr> | \`positive ctDNA\` |
`;

test.beforeEach(async ({ page }) => {
  await installWikiApiMocks(page, { pageOverrides: {
    "wiki/examples/drug-tooltips": { title: "Drug tooltip fixture", tags: [], content },
  } });
  await gotoWiki(page, "/wiki/examples/drug-tooltips");
});

test("drug tooltip supports hover, keyboard dismissal, and expanded tables", async ({ page }) => {
  const drug = page.getByRole("button", { name: "About Atezolizumab (Tecentriq)" });
  await drug.hover();
  await expect(page.getByRole("tooltip")).toContainText("PD-L1");
  await expect(page.getByRole("tooltip")).toContainText("Blocks PD-L1, helping T cells attack cancer.");
  await drug.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await page.getByRole("heading", { name: "Drug tooltip fixture", exact: true }).first().click();
  await drug.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await drug.press("Escape");
  await page.getByRole("button", { name: "Expand table", exact: true }).click();
  const expandedDrug = page.locator(".table-expansion-layer").getByRole("button", { name: "About Atezolizumab (Tecentriq)" });
  await expandedDrug.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByText("positive ctDNA", { exact: true }).last()).not.toHaveRole("button");
});

test.describe("touch access", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("drug tooltip can be tapped and stays inside a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const drug = page.getByRole("button", { name: "About Atezolizumab (Tecentriq)" });
    await drug.tap();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const bounds = await tooltip.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.getByRole("heading", { name: "Drug tooltip fixture", exact: true }).first().tap();
    await expect(tooltip).toBeHidden();
  });

});
