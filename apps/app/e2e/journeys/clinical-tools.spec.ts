import { expect, test, type Page } from "@playwright/test";
import { installWikiApiMocks } from "../fixtures";

const agiInputName = "Adjusted Gross Income (AGI)";
const medicalInputName = "Qualified Medical Expenses";

test.describe("clinical tools", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("the diagnostics timeline renders, stays aligned, zooms, and links to imaging", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    const header = page.locator("main > header").first();
    await expect(header.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Imaging" })).toHaveAttribute(
      "href",
      "/diagnostics/imaging",
    );
    await expect(header.getByRole("link", { name: "Summary" })).toHaveAttribute(
      "href",
      "/wiki/diagnostics/test-results-summary",
    );
    await expect(header.getByRole("link", { name: "ctDNA" })).toHaveAttribute(
      "href",
      "/wiki/diagnostics/ctdna-mrd",
    );
    await expect(page.getByTestId("timeline-sleeve-molecular")).toContainText(
      "ctDNA and Molecular Response",
    );
    await expect(page.getByTestId("timeline-track-signatera")).toBeVisible();
    await expect(page.getByTestId("timeline-track-petct")).toHaveCount(0);

    // The calendar axis and every swimlane scroll together.
    const scrollRegions = page.locator("[data-timeline-scroll-region]");
    const axis = page.getByTestId("timeline-axis-scroll-region");
    await expect
      .poll(() => axis.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    const axisScrollLeft = await axis.evaluate((element) => {
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
      element.dispatchEvent(new Event("scroll"));
      return element.scrollLeft;
    });
    expect(axisScrollLeft).toBeGreaterThan(0);
    await expect
      .poll(() =>
        scrollRegions.evaluateAll((elements) => elements.map((item) => item.scrollLeft)),
      )
      .toEqual(Array(await scrollRegions.count()).fill(axisScrollLeft));

    // Zoom by button, then pan by wheel, then reset.
    const timeline = page.getByTestId("diagnostic-timeline");
    const toolbar = page.getByTestId("timeline-sticky-header").getByTestId("timeline-toolbar");
    const rangeBefore = await timeline.getAttribute("data-visible-range");
    const zoomIn = toolbar.getByRole("button", { name: "Zoom in" });
    await expect
      .poll(async () => {
        await zoomIn.click();
        return timeline.getAttribute("data-visible-range");
      })
      .not.toBe(rangeBefore);
    const zoomed = await timeline.getAttribute("data-visible-range");
    const plotPanel = page.locator("[data-plot-panel]").first();
    const plotBox = (await plotPanel.boundingBox())!;
    await plotPanel.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: plotBox.x + plotBox.width / 2,
      clientY: plotBox.y + plotBox.height / 2,
      deltaX: 520,
      deltaY: 0,
      metaKey: false,
    });
    await expect(timeline).not.toHaveAttribute("data-visible-range", zoomed ?? "");
    await toolbar.getByRole("button", { name: "Reset timeline range" }).click();
    await expect(timeline).toHaveAttribute("data-visible-range", rangeBefore ?? "");

    // Imaging markers link to the imaging page and the DICOM viewer.
    const petctTrack = page.getByTestId("timeline-track-petct");
    await expect
      .poll(async () => {
        const currentCount = await petctTrack.count();
        if (currentCount > 0) return currentCount;
        await page.getByTestId("timeline-toggle-sleeve-imaging").click();
        await page.waitForTimeout(50);
        return petctTrack.count();
      })
      .toBe(1);
    await page.getByTestId("timeline-marker-cu-grip-petct-2026-06-10").hover();
    const tooltip = page.getByTestId("timeline-tooltip-cu-grip-petct-2026-06-10");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByRole("link", { name: "Imaging" })).toHaveAttribute(
      "href",
      "/diagnostics/imaging",
    );
    await expect(tooltip.getByRole("link", { name: "View images" })).toHaveAttribute(
      "href",
      "/tools/dicom-viewer?id=diagnostic-2026-06-10-petct",
    );
  });

  test("a phone drills from blood counts into ctDNA swimlanes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    const mobileTimeline = page.getByTestId("mobile-diagnostic-timeline");
    await expect(mobileTimeline).toBeVisible();
    await expect(page.getByTestId("timeline-sticky-header")).toBeHidden();
    await expect(mobileTimeline.getByTestId("mobile-blood-counts-chart")).toBeVisible();

    const bottomSheet = page.getByTestId("mobile-timeline-bottom-sheet");
    await expect(bottomSheet).toContainText("Hemoglobin");
    await expect(bottomSheet).toContainText("10.7 g/dL low");
    await expect(bottomSheet.getByRole("link", { name: "CBC" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/ucsf-mychart-test-results/04-may-26-2026-cbc-w-auto-diff-lab-only",
    );
    await mobileTimeline.getByRole("button", { name: /ANC: 0\.79/ }).focus();
    await page.keyboard.press("Enter");
    await expect(bottomSheet).toContainText("0.79 x10E9/L low");

    const swimlanes = mobileTimeline.getByTestId("mobile-swimlanes-molecular");
    await expect(swimlanes).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const currentCount = await swimlanes.count();
          if (currentCount > 0) return currentCount;
          await mobileTimeline.getByTestId("mobile-toggle-sleeve-molecular").click();
          await page.waitForTimeout(50);
          return swimlanes.count();
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    for (const track of ["signatera", "personalis", "guardant"]) {
      await expect(swimlanes.getByTestId(`mobile-swimlane-track-${track}`)).toBeVisible();
    }
    await swimlanes.getByTestId("mobile-swimlane-event-signatera-2026-05-28").click();
    await expect(bottomSheet).toContainText("0.17 MTM/mL positive");

    const timeline = page.getByTestId("diagnostic-timeline");
    const rangeBeforePan = await timeline.getAttribute("data-visible-range");
    const panBox = (await swimlanes.getByTestId("mobile-swimlane-pan-signatera").boundingBox())!;
    const y = panBox.y + panBox.height / 2;
    await page.mouse.move(panBox.x + panBox.width * 0.72, y);
    await page.mouse.down();
    await page.mouse.move(panBox.x + panBox.width * 0.72 + 90, y, { steps: 5 });
    await page.mouse.up();
    await expect(timeline).not.toHaveAttribute("data-visible-range", rangeBeforePan ?? "");
  });

  test("the ctDNA drill-in keeps its note outside the chart and its axes on the left", async ({
    page,
  }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await openDrilldown(page, "timeline-inspect-sleeve-molecular");
    const dialog = page.getByTestId("timeline-drilldown-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("timeline-drilldown-note")).toHaveCount(0);
    const chart = dialog.getByTestId("timeline-drilldown-chart");
    await expect(chart).toBeVisible();
    const chartBox = (await chart.boundingBox())!;

    const axes = await chart.evaluate((chartElement) => {
      const svg = chartElement.querySelector('[data-test-id="timeline-drilldown-svg"]')!;
      const axisSvg = chartElement.querySelector('[data-test-id="timeline-drilldown-axis-svg"]')!;
      const plotLeft = Number(
        svg
          .querySelector('[data-test-id="timeline-drilldown-plot-left-edge"]')
          ?.getAttribute("x1"),
      );
      return ["signatera", "personalis", "guardant"].map((id) => {
        const axis = axisSvg.querySelector(`[data-test-id="timeline-drilldown-axis-${id}"]`);
        const title = axisSvg.querySelector(`[data-test-id="timeline-drilldown-axis-label-${id}"]`);
        return {
          id,
          lineX: Number(axis?.querySelector("line")?.getAttribute("x1")),
          plotLeft,
          title: title?.textContent ?? "",
          transform: title?.getAttribute("transform") ?? "",
        };
      });
    });
    for (const axis of axes) {
      expect(axis.lineX, `${axis.id} axis stays left of the plot`).toBeLessThanOrEqual(axis.plotLeft);
      expect(axis.transform).toContain("rotate(-90");
    }
    expect(axes.map((axis) => axis.title)).toEqual([
      "Signatera (MTM/mL)",
      "NeXT Personal (PPM, log)",
      "Guardant360",
    ]);

    const guardantToggle = dialog.getByTestId("timeline-drilldown-track-toggle-guardant");
    await guardantToggle.click();
    await expect(guardantToggle).toHaveAttribute("aria-pressed", "false");
    await expect(dialog.getByTestId("timeline-drilldown-axis-guardant")).toHaveCount(0);
    await guardantToggle.click();
    await expect(dialog.getByTestId("timeline-drilldown-axis-guardant")).toBeVisible();

    await dialog.getByTestId("timeline-drilldown-point-signatera-signatera-2026-05-28").hover();
    const tooltip = page.getByTestId("timeline-drilldown-tooltip");
    await expect(tooltip).toContainText("0.17 MTM/mL positive");
    await expect(tooltip.getByRole("link", { name: "Source page" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/05-28-signatera-ctdna",
    );

    const rangeBeforeZoom = await chart.getAttribute("data-visible-range");
    await chart.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: chartBox.x + chartBox.width / 2,
      clientY: chartBox.y + chartBox.height / 2,
      deltaX: 0,
      deltaY: -360,
      metaKey: true,
    });
    await expect(chart).not.toHaveAttribute("data-visible-range", rangeBeforeZoom ?? "");

    // The blood-counts drill-in links its hover tooltip to the source CBC.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await openDrilldown(page, "timeline-inspect-sleeve-blood-counts");
    await expect(dialog.getByRole("heading", { name: "Blood Counts" })).toBeVisible();
    await dialog.getByTestId("timeline-drilldown-point-anc-anc-2026-05-07").hover();
    await expect(tooltip).toContainText("0.79 x10E9/L low");
    await expect(dialog.getByTestId("timeline-drilldown-axis-hemoglobin")).toHaveAttribute(
      "data-dimmed-axis",
      "true",
    );
    await expect(tooltip.getByRole("link", { name: "CBC" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/ucsf-mychart-test-results/19-may-07-2026-cbc-w-auto-diff-lab-only",
    );
  });

  test("the medical deduction calculator saves a scenario to the URL and restores it on reload", async ({
    page,
  }) => {
    await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });
    const agi = page.getByRole("textbox", { name: agiInputName });
    const medical = page.getByRole("textbox", { name: medicalInputName });
    await expect(page.getByTestId("medical-deduction-summary")).toContainText("$33,985");
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
    await planner.getByRole("spinbutton", { name: "Medical spend" }).first().fill("400000");

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
    await expect(page.getByRole("textbox", { name: medicalInputName })).toHaveValue("1,000,000");
    const restored = page.getByTestId("medical-deduction-multi-year");
    await expect(restored.getByLabel("Spread costs across multiple tax years")).toBeChecked();
    await expect(restored.getByLabel("Customize distribution")).toBeChecked();
    await expect(restored.getByText("Year 4", { exact: true })).toBeVisible();
    await expect(restored.getByRole("spinbutton", { name: "AGI" }).first()).toHaveValue("800000");
    await expect(restored.getByRole("spinbutton", { name: "Medical spend" }).first()).toHaveValue(
      "400000",
    );
  });

  test("the calculator clamps unsupported spend and selects scenarios from the keyboard grid", async ({
    page,
  }) => {
    await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });
    const summary = page.getByTestId("medical-deduction-summary");
    const agi = page.getByRole("textbox", { name: agiInputName });
    const medical = page.getByRole("textbox", { name: medicalInputName });
    await expect(summary).toContainText("Net cost after savings: $116,015");

    await medical.fill("-1");
    await medical.press("Enter");
    await expect(medical).toHaveValue("0");
    await expect(summary).toContainText("Estimated Tax Savings$0");
    await medical.fill("9999999");
    await medical.press("Enter");
    await expect(medical).toHaveValue("2,000,000");

    await expect(page.getByRole("slider", { name: `${agiInputName} slider` })).toBeVisible();
    const cell = page.getByRole("button", {
      name: /AGI \$900,000, medical \$1,000,000, estimated tax savings \$320,169/,
    });
    await cell.focus();
    await cell.press("Enter");
    await expect(agi).toHaveValue("900,000");
    await expect(medical).toHaveValue("1,000,000");
    await expect(summary).toContainText("$320,169");
    await expect(summary).toContainText("Net cost after savings: $679,831");
  });
});

test("an edit at the calculator's first interactive commit is not overwritten by startup effects", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Adjusted Gross Income (AGI)"]',
      );
      if (!input) return;
      observer.disconnect();
      // Enter at the first DOM commit, before passive startup effects.
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "900000",
      );
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

async function openDrilldown(page: Page, testId: string) {
  const trigger = page.getByTestId(testId);
  const dialog = page.getByTestId("timeline-drilldown-dialog");
  await expect
    .poll(
      async () => {
        if ((await dialog.count()) > 0) return 1;
        await trigger.scrollIntoViewIfNeeded();
        await expect(trigger).toBeVisible();
        await trigger.click();
        await dialog.waitFor({ state: "visible", timeout: 750 }).catch(() => {});
        return dialog.count();
      },
      { timeout: 15_000 },
    )
    .toBe(1);
}
