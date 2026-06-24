import { expect, test } from "@playwright/test";

test.describe("diagnostic timeline", () => {
  test("renders sleeves, week ticks, hover tooltips, diagnostics links, and zoom state", async ({
    page,
  }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Diagnostic Timeline" }),
    ).toBeVisible();
    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
    await expect(page.getByTestId("timeline-sleeve-molecular")).toContainText(
      "ctDNA and Molecular Response",
    );
    await expect(page.getByTestId("timeline-detail-panel")).toHaveCount(0);

    const weekTickCount = await page.getByTestId("timeline-week-tick").count();
    const monthTickCount = await page.getByTestId("timeline-month-tick").count();
    expect(weekTickCount).toBeGreaterThan(4);
    expect(weekTickCount).toBeGreaterThan(monthTickCount);

    const timeline = page.getByTestId("diagnostic-timeline");
    await expect(timeline).toHaveAttribute(
      "data-visible-range",
      `2026-04-02:${todayInPacificTime()}`,
    );
    const rangeBefore = await timeline.getAttribute("data-visible-range");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeBefore ?? "",
    );

    const rangeAfterButtonZoom = await timeline.getAttribute("data-visible-range");
    const plotPanel = page.locator("[data-plot-panel]").first();
    const plotBox = await plotPanel.boundingBox();
    expect(plotBox).not.toBeNull();

    await plotPanel.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: plotBox!.x + plotBox!.width / 2,
      clientY: plotBox!.y + plotBox!.height / 2,
      deltaX: 0,
      deltaY: -400,
      metaKey: false,
    });
    await expect(timeline).toHaveAttribute(
      "data-visible-range",
      rangeAfterButtonZoom ?? "",
    );

    await plotPanel.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: plotBox!.x + plotBox!.width / 2,
      clientY: plotBox!.y + plotBox!.height / 2,
      deltaX: 520,
      deltaY: 0,
      metaKey: false,
    });
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeAfterButtonZoom ?? "",
    );

    const rangeAfterHorizontalScroll = await timeline.getAttribute(
      "data-visible-range",
    );

    await plotPanel.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: plotBox!.x + plotBox!.width / 2,
      clientY: plotBox!.y + plotBox!.height / 2,
      deltaX: 0,
      deltaY: -400,
      metaKey: true,
    });
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeAfterHorizontalScroll ?? "",
    );

    await page.getByRole("button", { name: "Reset timeline range" }).click();
    await expect(timeline).toHaveAttribute(
      "data-visible-range",
      `2026-04-02:${todayInPacificTime()}`,
    );

    await expect(
      page.getByTestId("timeline-tooltip-signatera-2026-05-28"),
    ).toHaveCount(0);
    await page.getByTestId("timeline-marker-signatera-2026-05-28").hover();
    const signateraTooltip = page.getByTestId(
      "timeline-tooltip-signatera-2026-05-28",
    );
    await expect(signateraTooltip).toBeVisible();
    await expect(signateraTooltip).toContainText("0.17 MTM/mL positive");
    await expect(
      signateraTooltip.getByRole("link", { name: "Source page" }),
    ).toHaveAttribute("href", "/sources/diagnostics/05-28-signatera-ctdna");

    await page.getByTestId("timeline-marker-cu-grip-petct-2026-06-10").hover();
    const petTooltip = page.getByTestId(
      "timeline-tooltip-cu-grip-petct-2026-06-10",
    );
    await expect(petTooltip).toBeVisible();
    await expect(petTooltip).toContainText("64Cu-GRIP PET/CT");
    await expect(
      petTooltip.getByRole("link", { name: "View images" }),
    ).toHaveAttribute("href", "/tools/dicom-viewer?id=diagnostic-2026-06-10-petct");

    await page.getByTestId("timeline-filter").fill("Guardant360");
    await expect(page.getByTestId("timeline-track-guardant")).toBeVisible();
    await expect(page.getByTestId("timeline-track-signatera")).toHaveCount(0);
  });
});

function todayInPacificTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).formatToParts(new Date());
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}
