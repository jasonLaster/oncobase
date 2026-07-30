import { expect, test } from "@playwright/test";

test.describe("diagnostic timeline", () => {
  test("renders sleeves, week ticks, hover tooltips, diagnostics links, and zoom state", async ({
    page,
  }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Diagnostics" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Imaging" })).toHaveAttribute(
      "href",
      "/diagnostics/imaging",
    );
    await expect(page.getByRole("link", { name: "Summary" })).toHaveAttribute(
      "href",
      "/wiki/diagnostics/test-results-summary",
    );
    await expect(page.getByRole("link", { name: "ctDNA" })).toHaveAttribute(
      "href",
      "/wiki/diagnostics/ctdna-mrd",
    );
    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
    await expect(page.getByTestId("timeline-sleeve-molecular")).toContainText(
      "ctDNA and Molecular Response",
    );
    await expect(page.getByTestId("timeline-track-signatera")).toBeVisible();
    await expect(page.getByTestId("timeline-track-petct")).toHaveCount(0);
    await expect(page.getByTestId("timeline-track-anc")).toHaveCount(0);
    await expect(page.getByTestId("timeline-detail-panel")).toHaveCount(0);
    await expect(page.getByTestId("timeline-sticky-header")).toHaveCSS(
      "position",
      "sticky",
    );
    await expect(page.getByTestId("timeline-visible-range-label")).toContainText(
      "Apr 2",
    );
    await expect(
      page.getByTestId("timeline-sticky-header").getByTestId("timeline-filter"),
    ).toBeVisible();
    const stickyHeader = page.getByTestId("timeline-sticky-header");
    const toolbar = stickyHeader.getByTestId("timeline-toolbar");
    await expect(toolbar.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Show full timeline" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Focus molecular result window" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Focus recent results" }),
    ).toHaveCount(0);

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
    const zoomInButton = toolbar.getByRole("button", { name: "Zoom in" });
    await page.waitForLoadState("networkidle");
    await expect
      .poll(async () => {
        await zoomInButton.click();
        return timeline.getAttribute("data-visible-range");
      })
      .not.toBe(rangeBefore);

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
      deltaX: -520,
      deltaY: 0,
      metaKey: false,
    });
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeAfterHorizontalScroll ?? "",
    );

    const rangeAfterLeftScroll = await timeline.getAttribute("data-visible-range");
    expect(rangeStartTime(rangeAfterLeftScroll)).toBeLessThan(
      rangeStartTime(rangeAfterHorizontalScroll),
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
      rangeAfterLeftScroll ?? "",
    );

    await toolbar.getByRole("button", { name: "Reset timeline range" }).click();
    await expect(timeline).toHaveAttribute(
      "data-visible-range",
      `2026-04-02:${todayInPacificTime()}`,
    );

    await toolbar.getByRole("button", { name: "Zoom in" }).click();
    const rangeBeforeOverviewDrag = await timeline.getAttribute(
      "data-visible-range",
    );
    const overviewWindow = stickyHeader.getByTestId("timeline-overview-window");
    const overviewBox = await overviewWindow.boundingBox();
    expect(overviewBox).not.toBeNull();
    await page.mouse.move(
      overviewBox!.x + overviewBox!.width / 2,
      overviewBox!.y + overviewBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      overviewBox!.x + overviewBox!.width / 2 + 120,
      overviewBox!.y + overviewBox!.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeBeforeOverviewDrag ?? "",
    );

    const rangeBeforeLeftResize = await timeline.getAttribute("data-visible-range");
    const leftHandle = stickyHeader.getByTestId(
      "timeline-overview-window-left-handle",
    );
    const leftHandleBox = await leftHandle.boundingBox();
    expect(leftHandleBox).not.toBeNull();
    await page.mouse.move(
      leftHandleBox!.x + leftHandleBox!.width / 2,
      leftHandleBox!.y + leftHandleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      leftHandleBox!.x + leftHandleBox!.width / 2 + 80,
      leftHandleBox!.y + leftHandleBox!.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeBeforeLeftResize ?? "",
    );

    const rangeAfterLeftResize = await timeline.getAttribute("data-visible-range");
    const rightHandle = stickyHeader.getByTestId(
      "timeline-overview-window-right-handle",
    );
    const rightHandleBox = await rightHandle.boundingBox();
    expect(rightHandleBox).not.toBeNull();
    await page.mouse.move(
      rightHandleBox!.x + rightHandleBox!.width / 2,
      rightHandleBox!.y + rightHandleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      rightHandleBox!.x + rightHandleBox!.width / 2 - 80,
      rightHandleBox!.y + rightHandleBox!.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(timeline).not.toHaveAttribute(
      "data-visible-range",
      rangeAfterLeftResize ?? "",
    );

    await toolbar.getByRole("button", { name: "Reset timeline range" }).click();
    await expect(timeline).toHaveAttribute(
      "data-visible-range",
      `2026-04-02:${todayInPacificTime()}`,
    );

    await page.getByTestId("timeline-inspect-track-personalis").click();
    await expect(page.getByTestId("timeline-drilldown-dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "NeXT Personal" })).toBeVisible();
    await expect(page.getByTestId("timeline-drilldown-chart")).toBeVisible();
    await expect(page.getByTestId("timeline-drilldown-dialog")).toContainText("log");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("timeline-drilldown-dialog")).toHaveCount(0);

    await page.getByTestId("timeline-inspect-sleeve-molecular").click();
    await expect(page.getByTestId("timeline-drilldown-dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "ctDNA and Molecular Response" }),
    ).toBeVisible();
    await expect(page.getByTestId("timeline-drilldown-dialog")).toContainText(
      "Signatera",
    );
    await expect(page.getByTestId("timeline-drilldown-dialog")).toContainText(
      "NeXT Personal",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("timeline-drilldown-dialog")).toHaveCount(0);

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

    await page.getByTestId("timeline-toggle-sleeve-imaging").click();
    await page.getByTestId("timeline-marker-cu-grip-petct-2026-06-10").hover();
    const petTooltip = page.getByTestId(
      "timeline-tooltip-cu-grip-petct-2026-06-10",
    );
    await expect(petTooltip).toBeVisible();
    await expect(petTooltip).toContainText("64Cu-GRIP PET/CT");
    await expect(
      petTooltip.getByRole("link", { name: "View images" }),
    ).toHaveAttribute("href", "/tools/dicom-viewer?id=diagnostic-2026-06-10-petct");

    await stickyHeader.getByTestId("timeline-filter").fill("Guardant360");
    await expect(page.getByTestId("timeline-track-guardant")).toBeVisible();
    await expect(page.getByTestId("timeline-track-signatera")).toHaveCount(0);
  });
});

function rangeStartTime(range: string | null) {
  if (!range) return Number.NaN;
  return Date.parse(`${range.split(":")[0]}T00:00:00Z`);
}

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
