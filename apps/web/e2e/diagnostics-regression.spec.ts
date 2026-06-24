import { expect, test } from "@playwright/test";

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

    await page.getByTestId("timeline-inspect-sleeve-molecular").click();
    const dialog = page.getByTestId("timeline-drilldown-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("timeline-drilldown-note")).toContainText(
      "Normalized per swimlane",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-signatera")).toContainText(
      "Signatera",
    );
    await expect(dialog.getByTestId("timeline-drilldown-axis-personalis")).toContainText(
      "NeXT Personal",
    );
    await expect(dialog.getByTestId("timeline-drilldown-chart")).toBeVisible();

    await dialog
      .getByTestId("timeline-drilldown-point-signatera-signatera-2026-05-28")
      .hover();
    const tooltip = dialog.getByTestId("timeline-drilldown-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Signatera");
    await expect(tooltip).toContainText("0.17 MTM/mL positive");
    await expect(tooltip.getByRole("link", { name: "Source page" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/05-28-signatera-ctdna",
    );
  });

  test("group drill-in charts render axes, aligned markers, and hover tooltips", async ({
    page,
  }) => {
    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });

    await page.getByTestId("timeline-inspect-sleeve-blood-counts").click();
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
      .getByTestId("timeline-drilldown-svg")
      .evaluate((svgElement) => {
        const svg = svgElement as unknown as SVGSVGElement;
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
            return { circleCount: circles.length, id, maxDistance: Number.POSITIVE_INFINITY };
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
            circleCount: circles.length,
            id,
            maxDistance: Math.max(...distances),
          };
        });
        const matrix = svg.getScreenCTM();

        return {
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
    }

    await dialog.getByTestId("timeline-drilldown-point-anc-anc-2026-05-07").hover();
    const tooltip = dialog.getByTestId("timeline-drilldown-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("ANC");
    await expect(tooltip).toContainText("0.79 x10E9/L low");
    await expect(tooltip.getByRole("link", { name: "CBC" })).toHaveAttribute(
      "href",
      "/sources/diagnostics/ucsf-mychart-test-results/19-may-07-2026-cbc-w-auto-diff-lab-only",
    );
  });
});
