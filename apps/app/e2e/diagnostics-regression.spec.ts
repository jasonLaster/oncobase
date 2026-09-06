import { expect, test, type Page } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test.describe("diagnostics regressions", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("timeline route is the diagnostics landing page with the compact header", async ({
    page,
  }) => {
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

    await expect(header.getByText(/^As of\b/)).toHaveCount(0);
    await expect(header.getByText(/\b\d+\s+events\b/)).toHaveCount(0);
    await expect(header).not.toContainText(
      "Diagnostic, imaging, molecular, and lab results",
    );

    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
    await expect(page.getByTestId("timeline-sleeve-molecular")).toContainText(
      "ctDNA and Molecular Response",
    );
  });

  test("diagnostics alias renders the same timeline surface", async ({ page }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

    await expect(
      page.locator("main > header").first().getByRole("heading", {
        name: "Diagnostics",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
  });

  test("mobile diagnostics renders the blood-count chart and bottom sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    const mobileTimeline = page.getByTestId("mobile-diagnostic-timeline");
    await expect(mobileTimeline).toBeVisible();
    await expect(page.getByTestId("timeline-sticky-header")).toBeHidden();
    await expect(mobileTimeline.getByTestId("mobile-blood-counts-chart")).toBeVisible();

    const bottomSheet = page.getByTestId("mobile-timeline-bottom-sheet");
    await expect(bottomSheet).toBeVisible();
    await expect(bottomSheet).toContainText("May 26, 2026");
    await expect(bottomSheet).toContainText("Hemoglobin");
    await expect(bottomSheet).toContainText("10.7 g/dL low");
    await expect(bottomSheet.getByRole("link", { name: "CBC" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/ucsf-mychart-test-results/04-may-26-2026-cbc-w-auto-diff-lab-only",
    );

    await mobileTimeline.getByRole("button", { name: /ANC: 0\.79/ }).focus();
    await page.keyboard.press("Enter");
    await expect(bottomSheet).toContainText("ANC");
    await expect(bottomSheet).toContainText("0.79 x10E9/L low");
  });

  test("mobile diagnostics category rows expand to swimlanes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    const mobileTimeline = page.getByTestId("mobile-diagnostic-timeline");
    await expect(mobileTimeline).toBeVisible();
    await expect(mobileTimeline.getByTestId("mobile-swimlanes-molecular")).toHaveCount(
      0,
    );

    const swimlanes = mobileTimeline.getByTestId("mobile-swimlanes-molecular");
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
    await expect(swimlanes).toBeVisible();
    await expect(swimlanes.getByTestId("mobile-swimlane-track-signatera")).toBeVisible();
    await expect(
      swimlanes.getByTestId("mobile-swimlane-track-personalis"),
    ).toBeVisible();
    await expect(swimlanes.getByTestId("mobile-swimlane-track-guardant")).toBeVisible();

    await swimlanes.getByTestId("mobile-swimlane-event-signatera-2026-05-28").click();
    const bottomSheet = page.getByTestId("mobile-timeline-bottom-sheet");
    await expect(bottomSheet).toContainText("Signatera");
    await expect(bottomSheet).toContainText("0.17 MTM/mL positive");

    const timeline = page.getByTestId("diagnostic-timeline");
    const rangeBeforePan = await timeline.getAttribute("data-visible-range");
    const signateraPan = swimlanes.getByTestId("mobile-swimlane-pan-signatera");
    const signateraPanBox = await signateraPan.boundingBox();
    expect(signateraPanBox).not.toBeNull();
    await page.mouse.move(
      signateraPanBox!.x + signateraPanBox!.width * 0.72,
      signateraPanBox!.y + signateraPanBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      signateraPanBox!.x + signateraPanBox!.width * 0.72 + 90,
      signateraPanBox!.y + signateraPanBox!.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(timeline).not.toHaveAttribute("data-visible-range", rangeBeforePan ?? "");
  });

  test("timeline imaging tooltips link to imaging and the DICOM viewer", async ({
    page,
  }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("timeline-track-signatera")).toBeVisible();
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
    await expect(
      tooltip.getByRole("link", { name: "View images" }),
    ).toHaveAttribute("href", "/tools/dicom-viewer?id=diagnostic-2026-06-10-petct");
  });

  test("ctDNA category drill-in keeps the explanatory note outside the SVG chart", async ({
    page,
  }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await openDrilldown(page, "timeline-inspect-sleeve-molecular");
    const dialog = page.getByTestId("timeline-drilldown-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("timeline-drilldown-note")).toHaveCount(0);
    await expect(dialog.getByTestId("timeline-drilldown-axis-signatera")).toContainText(
      "Signatera",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-personalis")).toContainText(
      "NeXT Personal",
    );
    const drilldownChart = dialog.getByTestId("timeline-drilldown-chart");
    await expect(drilldownChart).toBeVisible();
    const chartBox = await drilldownChart.boundingBox();
    expect(chartBox).not.toBeNull();

    const ctdnaAxes = await drilldownChart.evaluate((chartElement) => {
      const chart = chartElement as HTMLElement;
      const svg = chart.querySelector(
        '[data-test-id="timeline-drilldown-svg"]',
      ) as SVGSVGElement;
      const axisSvg = chart.querySelector(
        '[data-test-id="timeline-drilldown-axis-svg"]',
      ) as SVGSVGElement;
      const plotLeft = Number(
        svg
          ?.querySelector('[data-test-id="timeline-drilldown-plot-left-edge"]')
          ?.getAttribute("x1"),
      );
      return ["signatera", "personalis", "guardant"].map((id) => {
        const axis = axisSvg?.querySelector(`[data-test-id="timeline-drilldown-axis-${id}"]`);
        const axisLine = axis?.querySelector("line");
        const title = axisSvg?.querySelector(
          `[data-test-id="timeline-drilldown-axis-label-${id}"]`,
        );
        return {
          id,
          lineX: Number(axisLine?.getAttribute("x1")),
          plotLeft,
          title: title?.textContent ?? "",
          transform: title?.getAttribute("transform") ?? "",
          values: Array.from(axis?.querySelectorAll("text") ?? [])
            .map((text) => text.textContent ?? "")
            .filter((text) => text !== title?.textContent),
        };
      });
    });
    for (const axis of ctdnaAxes) {
      expect(axis.lineX, `${axis.id} axis should stay on the left`).toBeLessThanOrEqual(
        axis.plotLeft,
      );
      expect(axis.transform).toContain("rotate(-90");
    }
    expect(ctdnaAxes.map((axis) => axis.title)).toEqual([
      "Signatera (MTM/mL)",
      "NeXT Personal (PPM, log)",
      "Guardant360",
    ]);
    expect(ctdnaAxes.find((axis) => axis.id === "personalis")?.values).toEqual([
      "1",
      "10",
      "100",
      "1000",
    ]);

    const guardantToggle = dialog.getByTestId("timeline-drilldown-track-toggle-guardant");
    await expect(guardantToggle).toHaveAttribute("aria-pressed", "true");
    await guardantToggle.click();
    await expect(guardantToggle).toHaveAttribute("aria-pressed", "false");
    await expect(dialog.getByTestId("timeline-drilldown-axis-guardant")).toHaveCount(0);
    await guardantToggle.click();
    await expect(guardantToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByTestId("timeline-drilldown-axis-guardant")).toBeVisible();

    await dialog
      .getByTestId("timeline-drilldown-point-signatera-signatera-2026-05-28")
      .hover();
    const tooltip = page.getByTestId("timeline-drilldown-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Signatera");
    await expect(tooltip).toContainText("0.17 MTM/mL positive");
    await expect(tooltip.getByRole("link", { name: "Source page" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/05-28-signatera-ctdna",
    );

    const rangeBeforeZoom = await drilldownChart.getAttribute("data-visible-range");
    await drilldownChart.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: chartBox!.x + chartBox!.width / 2,
      clientY: chartBox!.y + chartBox!.height / 2,
      deltaX: 0,
      deltaY: -360,
      metaKey: true,
    });
    await expect(drilldownChart).not.toHaveAttribute(
      "data-visible-range",
      rangeBeforeZoom ?? "",
    );
  });

  test("group drill-in charts render axes, aligned markers, and hover tooltips", async ({
    page,
  }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await openDrilldown(page, "timeline-inspect-sleeve-blood-counts");
    const dialog = page.getByTestId("timeline-drilldown-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Blood Counts" })).toBeVisible();
    await expect(dialog.getByTestId("timeline-drilldown-axis-anc")).toContainText(
      "ANC",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-hemoglobin")).toContainText(
      "Hemoglobin",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-platelets")).toContainText(
      "Platelets",
    );

    const chartGeometry = await dialog
      .getByTestId("timeline-drilldown-chart")
      .evaluate((chartElement) => {
        const chart = chartElement as HTMLElement;
        const svg = chart.querySelector(
          '[data-test-id="timeline-drilldown-svg"]',
        ) as SVGSVGElement;
        const axisSvg = chart.querySelector(
          '[data-test-id="timeline-drilldown-axis-svg"]',
        ) as SVGSVGElement;
        const parsePathPoints = (path: SVGPathElement) => {
          const d = path.getAttribute("d") ?? "";
          return Array.from(d.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)).map(
            (match) => ({
              x: Number(match[1]),
              y: Number(match[2]),
            }),
          );
        };
        const seriesIds = ["anc", "hemoglobin", "platelets"];
        const plotLeft = Number(
          svg
            .querySelector('[data-test-id="timeline-drilldown-plot-left-edge"]')
            ?.getAttribute("x1"),
        );
        const series = seriesIds.map((id) => {
          const path = svg.querySelector<SVGPathElement>(
            `[data-test-id="timeline-drilldown-series-${id}"]`,
          );
          const circles = Array.from(
            svg.querySelectorAll<SVGCircleElement>(
              `[data-test-id^="timeline-drilldown-point-${id}-"]`,
            ),
          );
          if (!path) {
            return {
              axisLineX: Number.NaN,
              circleCount: circles.length,
              id,
              maxDistance: Number.POSITIVE_INFINITY,
              titleTransform: null,
            };
          }
          const pathPoints = parsePathPoints(path);
          const distances = circles.map((circle, index) => {
            const pathPoint = pathPoints[index];
            if (!pathPoint) return Number.POSITIVE_INFINITY;
            return Math.hypot(
              Number(circle.getAttribute("cx")) - pathPoint.x,
              Number(circle.getAttribute("cy")) - pathPoint.y,
            );
          });

          return {
            axisLineX: Number(
              axisSvg
                .querySelector(`[data-test-id="timeline-drilldown-axis-${id}"] line`)
                ?.getAttribute("x1"),
            ),
            circleCount: circles.length,
            id,
            maxDistance: Math.max(...distances),
            title: axisSvg.querySelector(
              `[data-test-id="timeline-drilldown-axis-label-${id}"]`,
            )?.textContent,
            titleTransform: axisSvg
              .querySelector(`[data-test-id="timeline-drilldown-axis-label-${id}"]`)
              ?.getAttribute("transform"),
          };
        });
        const matrix = svg.getScreenCTM();

        return {
          plotLeft,
          scaleX: matrix?.a ?? Number.NaN,
          scaleY: matrix?.d ?? Number.NaN,
          series,
        };
      });

    expect(Math.abs(chartGeometry.scaleX - chartGeometry.scaleY)).toBeLessThan(0.02);
    for (const series of chartGeometry.series) {
      expect(series.circleCount).toBeGreaterThan(3);
      expect(series.maxDistance, `${series.id} dots should sit on the line`).toBeLessThan(
        0.001,
      );
      expect(series.axisLineX).toBeLessThanOrEqual(chartGeometry.plotLeft);
      expect(series.titleTransform).toContain("rotate(-90");
    }
    expect(chartGeometry.series.map((series) => series.title)).toEqual([
      "ANC (x10E9/L)",
      "Hemoglobin (g/dL)",
      "Platelets (x10E9/L)",
    ]);

    await dialog.getByTestId("timeline-drilldown-point-anc-anc-2026-05-07").hover();
    const tooltip = page.getByTestId("timeline-drilldown-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("ANC");
    await expect(tooltip).toContainText("0.79 x10E9/L low");
    await expect(dialog.getByTestId("timeline-drilldown-axis-anc")).toHaveAttribute(
      "data-active-axis",
      "true",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-hemoglobin")).toHaveAttribute(
      "data-dimmed-axis",
      "true",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-platelets")).toHaveAttribute(
      "data-dimmed-axis",
      "true",
    );
    await expect(tooltip.getByRole("link", { name: "CBC" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/ucsf-mychart-test-results/19-may-07-2026-cbc-w-auto-diff-lab-only",
    );
  });
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
