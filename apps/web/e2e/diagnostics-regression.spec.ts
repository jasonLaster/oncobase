import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe("diagnostics regressions", () => {
  test("diagnostics root is the timeline landing page with the compact header", async ({
    page,
  }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

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
    await expect(header).not.toContainText("Test results summary");
    await expect(header).not.toContainText("ctDNA / MRD monitoring");

    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
    await expect(page.getByTestId("timeline-sleeve-molecular")).toContainText(
      "ctDNA and Molecular Response",
    );
    await expect(page.getByTestId("diagnostics-sidebar")).toHaveCount(0);

    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "href",
      "/diagnostics",
    );
    await expect(sidebar.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "data-selected-file-tree-item",
      "true",
    );
    await expect(sidebar.getByTestId("sidebar-view-timeline")).toHaveCount(0);
  });

  test("legacy timeline route forwards to diagnostics", async ({ page }) => {
    await page.goto("/timeline", { waitUntil: "domcontentloaded" });

    await page.waitForURL(/\/diagnostics$/, { timeout: 15_000 });
    await expect(
      page.locator("main > header").first().getByRole("heading", {
        name: "Diagnostics",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
  });

  test("diagnostics header links route to the new imaging subpage", async ({
    page,
  }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

    await page.locator("main > header").first().getByRole("link", {
      name: "Imaging",
    }).click();
    await page.waitForURL(/\/diagnostics\/imaging$/, { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Imaging" })).toBeVisible();
    await expect(page.getByTestId("diagnostics-desktop-table")).toBeVisible();
  });

  test("imaging subpage keeps the normal app sidebar and table actions", async ({
    page,
  }) => {
    await page.goto("/diagnostics/imaging", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Imaging" })).toBeVisible();
    await expect(page.getByTestId("diagnostics-sidebar")).toHaveCount(0);

    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "data-selected-file-tree-item",
      "true",
    );
    await expect(sidebar.getByTestId("sidebar-view-timeline")).toHaveCount(0);

    const table = page.getByTestId("diagnostics-desktop-table");
    await expect(table.getByRole("columnheader", { name: "Reports" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "View images" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Download" })).toBeVisible();
    await expect(
      table.locator('a[href="/tools/dicom-viewer?id=diagnostic-2026-06-10-petct"]'),
    ).toBeVisible();
  });

  test("mobile page nav exposes only the diagnostics top-level app route", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("mobile-page-header")).toContainText(
      "Diagnostics",
    );
    await page.getByTestId("bottom-nav-trigger").click();

    const pageTree = page.getByTestId("bottom-nav-page-tree");
    await expect(pageTree).toBeVisible();
    await expect(pageTree.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "href",
      "/diagnostics",
    );
    await expect(pageTree.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "data-selected-file-tree-item",
      "true",
    );
    await expect(pageTree.getByTestId("sidebar-view-timeline")).toHaveCount(0);
  });

  test("timeline imaging tooltips link to imaging and the DICOM viewer", async ({
    page,
  }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

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
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

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
    const ctdnaAxes = await dialog
      .getByTestId("timeline-drilldown-chart")
      .evaluate((chartElement) => {
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
          const axis = axisSvg?.querySelector(
            `[data-test-id="timeline-drilldown-axis-${id}"]`,
          );
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
    await expect(
      dialog.getByTestId(
        "timeline-drilldown-point-signatera-signatera-late-june-planned",
      ),
    ).toHaveCount(0);
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
    for (let index = 0; index < 40; index += 1) {
      await drilldownChart.dispatchEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: chartBox!.x + chartBox!.width / 2,
        clientY: chartBox!.y + chartBox!.height / 2,
        deltaX: 0,
        deltaY: -500,
        metaKey: true,
      });
    }
    await expect
      .poll(async () => Number(await drilldownChart.getAttribute("data-visible-range-days")))
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => Number(await drilldownChart.getAttribute("data-visible-range-days")))
      .toBeLessThanOrEqual(3);
    await expect(
      drilldownChart.getByTestId("timeline-drilldown-day-tick"),
    ).not.toHaveCount(0);
    const zoomScrollMetrics = await drilldownChart.evaluate((chartElement) => {
      const chart = chartElement as HTMLElement;
      const svg = chart.querySelector(
        '[data-test-id="timeline-drilldown-svg"]',
      ) as SVGSVGElement | null;

      return {
        clientWidth: chart.clientWidth,
        scrollWidth: chart.scrollWidth,
        svgWidth: Number(svg?.getAttribute("width")),
      };
    });
    expect(zoomScrollMetrics.scrollWidth).toBeGreaterThan(
      zoomScrollMetrics.clientWidth * 5,
    );
    expect(zoomScrollMetrics.svgWidth).toBeGreaterThan(
      zoomScrollMetrics.clientWidth * 5,
    );
    const startAfterZoom = await visibleStartTime(drilldownChart);
    await drilldownChart.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: chartBox!.x + chartBox!.width / 2,
      clientY: chartBox!.y + chartBox!.height / 2,
      deltaX: 420,
      deltaY: 0,
      metaKey: false,
    });
    const startAfterRightScroll = await visibleStartTime(drilldownChart);
    expect(startAfterRightScroll).toBeGreaterThan(startAfterZoom);
    await expect(page).toHaveURL(/\/diagnostics$/);
    await drilldownChart.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: chartBox!.x + chartBox!.width / 2,
      clientY: chartBox!.y + chartBox!.height / 2,
      deltaX: -420,
      deltaY: 0,
      metaKey: false,
    });
    const startAfterLeftScroll = await visibleStartTime(drilldownChart);
    expect(startAfterLeftScroll).toBeLessThan(startAfterRightScroll);
    await expect(page).toHaveURL(/\/diagnostics$/);

    await drilldownChart.evaluate((chartElement) => {
      const chart = chartElement as HTMLElement;
      chart.scrollLeft = 0;
      chart.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect
      .poll(async () => visibleStartTime(drilldownChart))
      .toBeLessThanOrEqual(startAfterLeftScroll);
    const leftEdgeMetrics = await drilldownChart.evaluate((chartElement) => {
      const chart = chartElement as HTMLElement;
      const firstPoint = chart.querySelector(
        '[data-test-id="timeline-drilldown-point-signatera-signatera-2026-04-01"]',
      ) as SVGCircleElement | null;
      const axis = chart.querySelector(
        '[data-test-id="timeline-drilldown-axis-svg"]',
      ) as SVGSVGElement | null;
      const pointBox = firstPoint?.getBoundingClientRect();
      const axisBox = axis?.getBoundingClientRect();

      return {
        axisRight: axisBox?.right ?? 0,
        pointLeft: pointBox?.left ?? 0,
        scrollLeft: chart.scrollLeft,
      };
    });
    expect(leftEdgeMetrics.scrollLeft).toBe(0);
    expect(leftEdgeMetrics.pointLeft).toBeGreaterThan(leftEdgeMetrics.axisRight);

    await drilldownChart.evaluate((chartElement) => {
      const chart = chartElement as HTMLElement;
      chart.scrollLeft = chart.scrollWidth - chart.clientWidth;
      chart.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const rightEdgeMetrics = await drilldownChart.evaluate((chartElement) => {
      const chart = chartElement as HTMLElement;
      const viewport = chart.getBoundingClientRect();
      const latestPoint = chart.querySelector(
        '[data-test-id="timeline-drilldown-point-personalis-personalis-2026-06-09"]',
      ) as SVGCircleElement | null;
      const pointBox = latestPoint?.getBoundingClientRect();

      return {
        pointLeft: pointBox?.left ?? 0,
        pointRight: pointBox?.right ?? 0,
        viewportLeft: viewport.left,
        viewportRight: viewport.right,
      };
    });
    expect(rightEdgeMetrics.pointLeft).toBeLessThanOrEqual(
      rightEdgeMetrics.viewportRight,
    );
    expect(rightEdgeMetrics.pointRight).toBeGreaterThanOrEqual(
      rightEdgeMetrics.viewportLeft,
    );
  });

  test("group drill-in charts render axes, aligned markers, and hover tooltips", async ({
    page,
  }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

    await openDrilldown(page, "timeline-inspect-sleeve-blood-counts");
    const dialog = page.getByTestId("timeline-drilldown-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Blood Counts" })).toBeVisible();
    await expect(dialog.getByTestId("timeline-drilldown-axis-anc")).toContainText(
      "ANC",
    );
    await expect(
      dialog.getByTestId("timeline-drilldown-axis-hemoglobin"),
    ).toContainText("Hemoglobin");
    await expect(
      dialog.getByTestId("timeline-drilldown-axis-platelets"),
    ).toContainText("Platelets");

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
      expect(
        series.axisLineX,
        `${series.id} y-axis should be on the left side of the plot`,
      ).toBeLessThanOrEqual(chartGeometry.plotLeft);
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
    await expect(
      dialog.getByTestId("timeline-drilldown-axis-hemoglobin"),
    ).toHaveAttribute("data-dimmed-axis", "true");
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

async function visibleStartTime(locator: Locator) {
  return Number(await locator.getAttribute("data-visible-start-time"));
}
