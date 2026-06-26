import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { diagnosticComparisonsSeed } from "../scripts/fixtures/diagnostic-comparisons-seed";
import { diagnosticStudiesSeed } from "../scripts/fixtures/diagnostic-studies-seed";

/**
 * Verifies the DICOM viewer contract documented in
 * apps/web/specs/dicom-viewer.md.
 */

const biopsyLinks = [
  {
    id: "diagnostic-2026-06-26-breast-mri",
    title: "June 26 breast MRI",
    directory: "06-26-breast-mri/dicoms",
    counter: "890 / 1778",
  },
  {
    id: "diagnostic-2026-06-10-petct",
    title: "June 10 PET/CT",
    directory: "05-10-petct/dicoms",
    counter: "308 / 615",
  },
  {
    id: "diagnostic-2026-04-01-breast-mri",
    title: "April 1 breast MRI",
    directory: "04-01-breast-mri/dicoms",
    counter: "616 / 1230",
  },
  {
    id: "diagnostic-2026-03-27-petct",
    title: "March 27 PET/CT",
    directory: "03-27-petct/dicoms",
    counter: "173 / 344",
  },
  {
    id: "diagnostic-2026-03-20-ultrasound",
    title: "March 20 ultrasound",
    directory: "03-20-ultrasound/dicoms",
    counter: "6 / 11",
  },
  {
    id: "biopsy-2026-04-10",
    title: "April 10 biopsy",
    directory: "4-10 biopsy/LASTERDIANAD (1)/SER00003",
    counter: "5 / 9",
  },
  {
    id: "diagnostic-2026-02-20-ultrasound",
    title: "February 20 ultrasound",
    directory: "02-20-ultrasound/dicoms",
    counter: "12 / 22",
  },
  {
    id: "biopsy-2026-03-23",
    title: "March 23 axilla biopsy",
    directory: "3-23 - US Axilla biopsy/LASTERDIANAD (1)/SER00001",
    counter: "23 / 45",
  },
  {
    id: "biopsy-2026-03-13",
    title: "March 13 biopsy",
    directory: "3-13 - Biopsy/DIANA LASTER_BIOPSY (S)_03-13-2026",
    counter: "10 / 19",
  },
];
const breastMriReportPath = "sources/diagnostics/401-breast-mri.pdf";
const isProdRun = process.env.TEST_ENV === "prod";
const seededStudySet = `playwright-dicom-${Date.now()}`;
const seededStudySetQuery = isProdRun ? "" : `?studySet=${seededStudySet}`;
const seededStudySetParam = isProdRun ? "" : `&studySet=${seededStudySet}`;
const liveDiagnosticsReportLinks = Array.from(
  new Set(
    diagnosticStudiesSeed.studies.flatMap((study) => [
      study.pathologyReportHref,
      ...(study.reportLinks?.map((link) => link.href) ?? []),
    ]),
  ),
);

async function gotoViewer(page: Page, biopsyId = "biopsy-2026-04-10") {
  await page.goto(`/tools/dicom-viewer?id=${biopsyId}${seededStudySetParam}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
  await expect(page.getByRole("button", { name: "W/L", exact: true })).toBeVisible();
  await expect(
    page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
    timeout: 30_000,
  });
}

async function seedDiagnosticStudies(
  request: APIRequestContext,
  baseURL: string | undefined,
  studySet: string,
  studies: unknown,
) {
  const appBaseURL = baseURL ?? "http://localhost:3000";
  const response = await request.post(`${appBaseURL}/api/test/diagnostic-studies`, {
    data: { studySet, studies },
  });
  expect(response.ok()).toBe(true);
}

async function seedDiagnosticComparisons(
  request: APIRequestContext,
  baseURL: string | undefined,
  comparisonSet: string,
  comparisons: unknown,
) {
  const appBaseURL = baseURL ?? "http://localhost:3000";
  const response = await request.post(`${appBaseURL}/api/test/dicom-comparisons`, {
    data: { comparisonSet, comparisons },
  });
  expect(response.ok()).toBe(true);
}

async function expectToolState(
  page: Page,
  expected: { window: boolean; pan: boolean; zoom: boolean },
) {
  await expect(page.getByRole("button", { name: "W/L", exact: true })).toHaveAttribute(
    "aria-pressed",
    String(expected.window),
  );
  await expect(page.getByRole("button", { name: "Pan", exact: true })).toHaveAttribute(
    "aria-pressed",
    String(expected.pan),
  );
  await expect(page.getByRole("button", { name: "Zoom", exact: true })).toHaveAttribute(
    "aria-pressed",
    String(expected.zoom),
  );
}

async function installInteractionProbe(page: Page) {
  await page.evaluate(() => {
    type Probe = { cameraModified: number; voiModified: number };
    const win = window as typeof window & {
      __dicomInteractionProbe?: Probe;
      __dicomInteractionProbeInstalled?: boolean;
    };
    win.__dicomInteractionProbe ??= { cameraModified: 0, voiModified: 0 };
    if (win.__dicomInteractionProbeInstalled) return;

    const viewport = document.querySelector(
      '[data-test-id="dicom-cornerstone-viewport"]',
    );
    viewport?.addEventListener("CORNERSTONE_CAMERA_MODIFIED", () => {
      if (win.__dicomInteractionProbe) win.__dicomInteractionProbe.cameraModified += 1;
    });
    viewport?.addEventListener("CORNERSTONE_VOI_MODIFIED", () => {
      if (win.__dicomInteractionProbe) win.__dicomInteractionProbe.voiModified += 1;
    });
    win.__dicomInteractionProbeInstalled = true;
  });
}

async function resetInteractionProbe(page: Page) {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __dicomInteractionProbe?: { cameraModified: number; voiModified: number };
    };
    win.__dicomInteractionProbe = { cameraModified: 0, voiModified: 0 };
  });
}

async function interactionProbe(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __dicomInteractionProbe?: { cameraModified: number; voiModified: number };
    };
    return win.__dicomInteractionProbe ?? { cameraModified: 0, voiModified: 0 };
  });
}

async function dispatchTouchDrag(
  page: Page,
  start: Array<{ x: number; y: number }>,
  end: Array<{ x: number; y: number }>,
) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: Math.max(start.length, end.length, 2),
  });

  const pointAt = (
    points: Array<{ x: number; y: number }>,
    index: number,
    step: number,
    steps: number,
  ) => {
    const next = end[index] ?? points[index];
    const current = points[index];
    return {
      id: index + 1,
      x: Math.round(current.x + (next.x - current.x) * (step / steps)),
      y: Math.round(current.y + (next.y - current.y) * (step / steps)),
      radiusX: 1,
      radiusY: 1,
      force: 1,
    };
  };

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: start.map((point, index) => ({
      id: index + 1,
      x: Math.round(point.x),
      y: Math.round(point.y),
      radiusX: 1,
      radiusY: 1,
      force: 1,
    })),
  });

  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: start.map((_, index) => pointAt(start, index, step, 6)),
    });
    await page.waitForTimeout(16);
  }

  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await client.detach();
}

function holdDicomFileRequest(page: Page, fileName: string) {
  let release = () => {};
  let released = false;
  const requestSeen = new Promise<void>((resolve) => {
    void page.route("**/api/dicom/file?**", async (route) => {
      const url = route.request().url();
      if (!url.includes(fileName) || released) {
        await route.continue();
        return;
      }

      resolve();
      await new Promise<void>((next) => {
        release = next;
      });
      released = true;
      await route.continue();
    });
  });

  return {
    requestSeen,
    release: () => release(),
  };
}

test.describe.configure({ mode: "serial" });

test.describe("DICOM viewer", () => {
  test.beforeAll(async ({ request, baseURL }) => {
    if (isProdRun) return;
    await seedDiagnosticStudies(
      request,
      baseURL,
      seededStudySet,
      diagnosticStudiesSeed.studies,
    );
    await seedDiagnosticComparisons(
      request,
      baseURL,
      seededStudySet,
      diagnosticComparisonsSeed.comparisons,
    );
  });

  test("diagnostics imaging page links each biopsy shortcut to the viewer", async ({ page }) => {
    await page.goto(`/diagnostics/imaging${seededStudySetQuery}`);

    await expect(page.getByRole("heading", { name: "Imaging" })).toBeVisible();
    const desktopTable = page.getByTestId("diagnostics-desktop-table");
    await expect(desktopTable.getByRole("columnheader", { name: "Reports" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Images" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Comparisons" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Download" })).toBeVisible();
    await expect(
      desktopTable.getByRole("link", { name: "Download source bundle" }),
    ).toHaveCount(6);
    for (const biopsy of biopsyLinks) {
      const viewerLink = desktopTable.locator(
        `a[href="/tools/dicom-viewer?id=${biopsy.id}${seededStudySetParam}"]`
      );

      await expect(viewerLink).toBeVisible();
      await expect(viewerLink).toHaveAttribute("aria-label", "Images");
      await expect(viewerLink).not.toContainText("Images");
      await expect(viewerLink).toHaveAttribute(
        "href",
        `/tools/dicom-viewer?id=${biopsy.id}${seededStudySetParam}`,
      );
    }

    const breastMriRow = desktopTable.getByRole("row", {
      name: /Apr 1, 2026.*Breast MRI/,
    });
    await breastMriRow.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByRole("menuitem", { name: "MRI" })).toHaveAttribute(
      "href",
      "/api/file?path=sources%2Fdiagnostics%2F401-breast-mri.pdf",
    );
    await expect(page.getByRole("menuitem", { name: "Breast biopsy" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Axilla biopsy" })).toBeVisible();
    await page.keyboard.press("Escape");

    if (!isProdRun) {
      const comparisonButtons = desktopTable.getByRole("button", { name: "Comparisons" });
      await expect(comparisonButtons).toHaveCount(2);
      await expect(comparisonButtons.first()).not.toContainText("Comparisons");
      await breastMriRow.getByRole("button", { name: "Comparisons" }).click();
      await expect(
        page.getByRole("menuitem", { name: "April 1 vs June 26 breast MRI" }),
      ).toHaveAttribute(
        "href",
        `/tools/dicom-compare?comparison=mri-comparison-2026-04-01-vs-2026-06-26&studySet=${seededStudySet}`,
      );
      await expect(
        desktopTable.getByRole("row", { name: /PET\/CT/ }).first().getByText("—"),
      ).toBeVisible();
    }
  });

  test("diagnostics imaging page uses a compact mobile study list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/diagnostics/imaging${seededStudySetQuery}`);

    const mobileList = page.getByTestId("diagnostics-mobile-list");
    await expect(mobileList).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
    await expect(
      mobileList.getByRole("link", { name: /Images/ }),
    ).toHaveCount(biopsyLinks.length);
    await expect(
      mobileList.getByRole("link", { name: /Images/ }).first(),
    ).toHaveAttribute(
      "href",
      `/tools/dicom-viewer?id=diagnostic-2026-06-26-breast-mri${seededStudySetParam}`,
    );
  });

  test("diagnostics imaging reflects local test DB metadata changes without a deploy", async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(isProdRun, "Local-only DB mutation route is not available in production.");

    const studySet = `playwright-dynamic-${Date.now()}`;
    const study = {
      id: "diagnostic-playwright-dynamic-petct",
      shortLabel: "PW",
      title: "Playwright DB title before",
      dateLabel: "Jun 10, 2026",
      isoDate: "2026-06-10",
      modality: "PET/CT",
      focus: "Dynamic test stack",
      directoryIncludes: "05-10-petct",
      pathologyReportHref: "/sources/diagnostics/06-10-cu-grip-petct",
      reportLinks: [
        {
          label: "PET/CT report",
          href: "/sources/diagnostics/06-10-cu-grip-petct",
        },
      ],
    };

    await seedDiagnosticStudies(request, baseURL, studySet, [study]);
    await page.goto(`/diagnostics/imaging?studySet=${studySet}`);
    const desktopTable = page.getByTestId("diagnostics-desktop-table");
    await expect(desktopTable.getByText("Playwright DB title before")).toBeVisible();
    await expect(desktopTable.getByText("Playwright DB title after")).toHaveCount(0);

    await seedDiagnosticStudies(request, baseURL, studySet, [
      { ...study, title: "Playwright DB title after" },
    ]);
    await page.reload();
    await expect(desktopTable.getByText("Playwright DB title after")).toBeVisible();
    await expect(desktopTable.getByText("Playwright DB title before")).toHaveCount(0);
    await expect(
      desktopTable.locator(
        `a[href="/tools/dicom-viewer?id=diagnostic-playwright-dynamic-petct&studySet=${studySet}"]`,
      ),
    ).toBeVisible();
  });

  test("comparison viewer renders paired MRI stacks from dynamic metadata", async ({ page }) => {
    test.skip(isProdRun, "Local seeded comparison metadata is not available in production.");

    await page.goto(
      `/tools/dicom-compare?comparison=mri-comparison-2026-04-01-vs-2026-06-26${seededStudySetParam}`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByRole("heading", { name: "April 1 vs June 26 breast MRI" })).toBeVisible();
    await expect(page.getByTestId("dicom-compare-pair-phase-2-subtraction")).toContainText(
      "Phase-2 subtraction",
    );
    await expect(page.getByTestId("dicom-compare-left-viewport")).toBeVisible();
    await expect(page.getByTestId("dicom-compare-right-viewport")).toBeVisible();
    await expect(
      page.locator('[data-test-id="dicom-compare-left-viewport"] canvas'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('[data-test-id="dicom-compare-right-viewport"] canvas'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-compare-left-loading")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-compare-right-loading")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-compare-left-counter")).toContainText("/ 246");
    await expect(page.getByTestId("dicom-compare-right-counter")).toContainText("/ 254");
    await expect(page.getByTestId("dicom-compare-match-state")).toContainText(/z|fallback/i);
    await expect(page.getByText("Marked overall improvement")).toBeVisible();
    await expect(page.getByTestId("dicom-compare-precomputed-panel")).toContainText(
      "Annotated subtraction report slices",
    );
  });

  test("diagnostics report links stay live and surfaced PDFs support password-gated byte-range loading", async ({
    request,
    baseURL,
  }) => {
    const pdfRes = await request.get(
      `${baseURL}/api/file?path=${encodeURIComponent(breastMriReportPath)}`,
      {
        headers: {
          Cookie: "authed=true",
          Range: "bytes=0-99",
        },
      },
    );

    expect(pdfRes.status()).toBe(206);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    expect(pdfRes.headers()["content-disposition"]).toContain("inline");
    expect(pdfRes.headers()["cache-control"]).toContain("private");
    expect(pdfRes.headers()["vary"]).toContain("Cookie");
    expect(pdfRes.headers()["vary"]).toContain("Range");
    expect(pdfRes.headers()["content-length"]).toBe("100");
    expect(pdfRes.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await pdfRes.body()).subarray(0, 5).toString()).toBe("%PDF-");

    for (const href of liveDiagnosticsReportLinks) {
      const res = await request.get(`${baseURL}${href}`, {
        headers: {
          Cookie: "authed=true",
          ...(href.includes("/api/file?path=") ? { Range: "bytes=0-99" } : {}),
        },
      });

      expect([200, 206]).toContain(res.status());
    }
  });

  test("diagnostics imaging page uses the normal sidebar and viewer uses biopsy shortcuts", async ({
    page,
  }) => {
    await page.goto(`/diagnostics/imaging${seededStudySetQuery}`);

    const sidebar = page
      .getByTestId("app-shell")
      .locator('[data-test-id="sidebar"]:visible')
      .first();
    await expect(sidebar).toBeVisible();
    await expect(page.getByTestId("diagnostics-sidebar")).toHaveCount(0);
    await expect(sidebar.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "href",
      "/diagnostics",
    );
    await expect(sidebar.getByTestId("sidebar-view-diagnostics")).toHaveAttribute(
      "data-selected-file-tree-item",
      "true",
    );
    await expect(sidebar.getByRole("link", { name: "March 13 biopsy" })).toHaveCount(0);
    await expect(sidebar).toContainText("project management");

    await page.goto(`/tools/dicom-viewer?id=biopsy-2026-03-23${seededStudySetParam}`);
    await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
    const viewerSidebar = page.getByTestId("diagnostics-sidebar");
    await expect(viewerSidebar).toBeVisible();
    await expect(viewerSidebar.getByRole("link")).toHaveCount(biopsyLinks.length);
    await expect(
      viewerSidebar.getByRole("link", { name: "March 13 biopsy" }),
    ).toHaveAttribute(
      "href",
      `/tools/dicom-viewer?id=biopsy-2026-03-13${seededStudySetParam}`,
    );

    const seriesPanel = page.getByTestId("dicom-series-panel");
    await expect(seriesPanel).toContainText("3-23 - US Axilla biopsy");
    await expect(seriesPanel).not.toContainText("4-10 biopsy");
    await expect(page.getByTestId("dicom-pathology-report-link")).toHaveAttribute(
      "href",
      "/sources/diagnostics/03-23-us-axilla-core-biopsy",
    );
    await expect(page.getByTestId("dicom-pathology-report-link")).toContainText(
      "Pathology report",
    );
    const backLink = page.getByTestId("dicom-back-to-imaging");
    await expect(backLink).toHaveAttribute(
      "href",
      `/diagnostics/imaging${seededStudySetQuery}`,
    );
    await backLink.click();
    await expect(page.getByRole("heading", { name: "Imaging" })).toBeVisible();
  });

  for (const biopsy of biopsyLinks) {
    test(`viewer selects the ${biopsy.id} image stack`, async ({ page }) => {
      await gotoViewer(page, biopsy.id);

      await expect(page.getByTestId("dicom-slice-counter")).toHaveText(
        biopsy.counter,
        { timeout: 30_000 },
      );
      await expect(page.locator("dd", { hasText: biopsy.directory }).first()).toBeVisible();
    });
  }

  test("collapses the diagnostics and stack rails from the viewer rails", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoViewer(page);

    await expect(page.locator("[data-sidebar-layout]")).toHaveAttribute(
      "data-sidebar-state",
      "expanded",
    );
    await expect(page.getByTestId("diagnostics-sidebar")).toBeVisible();
    await expect(page.getByTestId("dicom-stack-panel")).toBeVisible();
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });

    await page.getByTestId("dicom-collapse-guardrails").click();

    await expect(page.locator("[data-sidebar-layout]")).toHaveAttribute(
      "data-sidebar-state",
      "collapsed",
    );
    await expect(page.getByTestId("dicom-stack-panel")).toBeHidden();

    await page.getByTestId("dicom-toggle-stack-rail").click();
    await expect(page.getByTestId("dicom-stack-panel")).toBeVisible();
  });

  test("gives the image viewport the full width in mobile landscape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await gotoViewer(page, "biopsy-2026-04-10");

    await expect(page.getByTestId("mobile-page-header")).toBeHidden();
    await expect(page.locator('[data-test-id="diagnostics-sidebar"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-series-panel"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-stack-panel"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-mobile-study-trigger"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("dicom-mobile-series-bar")).toBeVisible();
    await expect(page.getByTestId("dicom-mobile-series-bar")).toContainText(
      "2026-04-10 · US · US Axilla Core BX RT IMGUS0248 · Series 2",
    );

    const frameBox = await page.getByTestId("dicom-viewport-frame").boundingBox();
    expect(frameBox?.width).toBeGreaterThan(800);
    expect(frameBox?.height).toBeGreaterThan(280);
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });

    const canvasState = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-test-id="dicom-cornerstone-viewport"] canvas',
      );
      return {
        height: canvas?.height ?? 0,
        imageBytes: canvas?.toDataURL("image/png").length ?? 0,
        width: canvas?.width ?? 0,
      };
    });
    expect(canvasState.width).toBeGreaterThan(800);
    expect(canvasState.height).toBeGreaterThan(260);
    expect(canvasState.imageBytes).toBeGreaterThan(8_000);
  });

  test("uses a bottom sheet for study navigation in mobile portrait", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoViewer(page, "biopsy-2026-04-10");
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });

    await expect(page.locator('[data-test-id="dicom-series-panel"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="mobile-page-header"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="mobile-ask-wiki"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-mobile-study-trigger"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("dicom-mobile-series-bar")).toBeVisible();
    await expect(page.getByTestId("dicom-mobile-series-bar")).toContainText(
      "2026-04-10 · US · US Axilla Core BX RT IMGUS0248 · Series 2",
    );

    const controls = await page.getByTestId("dicom-controls").boundingBox();
    const frame = await page.getByTestId("dicom-viewport-frame").boundingBox();
    const seriesBar = await page.getByTestId("dicom-mobile-series-bar").boundingBox();
    const toolsRow = await page.getByTestId("dicom-tools-row").boundingBox();
    const cineRow = await page.getByTestId("dicom-cine-row").boundingBox();
    expect(controls?.y).toBeLessThan(frame?.y ?? 0);
    expect(controls?.y).toBeLessThan(12);
    expect(seriesBar?.y).toBeGreaterThan(frame?.y ?? 0);
    expect(toolsRow?.y).toBeLessThan(cineRow?.y ?? 0);

    await page.getByTestId("dicom-mobile-series-bar").click();
    const sheet = page.getByTestId("dicom-mobile-study-sheet");
    await expect(sheet).toHaveAttribute("data-state", "open");
    await expect(sheet.getByTestId("dicom-mobile-series-list")).toBeVisible();
    await expect(sheet.getByText("April 10 biopsy")).toBeVisible();

    await sheet.getByRole("button", { name: "Report", exact: true }).click();
    await expect(sheet.getByTestId("dicom-mobile-pathology-report-link")).toHaveAttribute(
      "href",
      "/api/file?path=sources%2Fdiagnostics%2F04-10-kernis-path-report%2F04-10-kernis-path-report.pdf",
    );
  });

  test("pan and zoom act as toggles back to window-level", async ({ page }) => {
    await gotoViewer(page);

    await expectToolState(page, { window: true, pan: false, zoom: false });

    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await expectToolState(page, { window: false, pan: false, zoom: true });

    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await expectToolState(page, { window: true, pan: false, zoom: false });

    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await expectToolState(page, { window: false, pan: true, zoom: false });

    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await expectToolState(page, { window: true, pan: false, zoom: false });

    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await expectToolState(page, { window: false, pan: true, zoom: false });
  });

  test("tool switches preserve the current viewport position", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoViewer(page);
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Next image" }).click();
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9");
    await installInteractionProbe(page);

    const switches = [
      {
        name: "Pan",
        state: { window: false, pan: true, zoom: false },
      },
      {
        name: "Zoom",
        state: { window: false, pan: false, zoom: true },
      },
      {
        name: "W/L",
        state: { window: true, pan: false, zoom: false },
      },
    ];

    for (const switchTo of switches) {
      await resetInteractionProbe(page);
      await page.getByRole("button", { name: switchTo.name, exact: true }).click();
      await expectToolState(page, switchTo.state);
      await page.waitForTimeout(300);

      await expect(page.getByTestId("dicom-image-loading")).toBeHidden();
      await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9");
      expect(await interactionProbe(page)).toEqual({
        cameraModified: 0,
        voiModified: 0,
      });
    }
  });

  test("mobile touch drags drive the selected pan and zoom tools", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoViewer(page);
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });
    await installInteractionProbe(page);

    await expect(page.getByTestId("dicom-viewport-frame")).toHaveCSS(
      "touch-action",
      "none",
    );

    const box = await page.getByTestId("dicom-cornerstone-viewport").boundingBox();
    expect(box).not.toBeNull();
    const center = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };

    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await expectToolState(page, { window: false, pan: true, zoom: false });
    await resetInteractionProbe(page);
    await dispatchTouchDrag(
      page,
      [{ x: center.x, y: center.y }],
      [{ x: center.x + 70, y: center.y + 35 }],
    );
    await expect
      .poll(async () => (await interactionProbe(page)).cameraModified)
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await expectToolState(page, { window: false, pan: false, zoom: true });
    await resetInteractionProbe(page);
    await dispatchTouchDrag(
      page,
      [{ x: center.x, y: center.y }],
      [{ x: center.x, y: center.y - 80 }],
    );
    await expect
      .poll(async () => (await interactionProbe(page)).cameraModified)
      .toBeGreaterThan(0);

    await resetInteractionProbe(page);
    await dispatchTouchDrag(
      page,
      [
        { x: center.x - 24, y: center.y },
        { x: center.x + 24, y: center.y },
      ],
      [
        { x: center.x - 58, y: center.y },
        { x: center.x + 58, y: center.y },
      ],
    );
    await expect
      .poll(async () => (await interactionProbe(page)).cameraModified)
      .toBeGreaterThan(0);
  });

  test("next image shows loading state while the requested DICOM file is pending", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const heldRequest = holdDicomFileRequest(page, "IMG00006.dcm");

    await gotoViewer(page, "biopsy-2026-04-10");
    await heldRequest.requestSeen;

    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9");

    await page.getByRole("button", { name: "Next image" }).click();

    await expect(page.getByTestId("dicom-image-loading")).toBeVisible();
    await expect(page.getByTestId("dicom-image-loading")).toContainText(
      "Loading image 6",
    );
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9");

    heldRequest.release();

    await expect(page.getByTestId("dicom-image-loading")).toBeHidden();
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9");
  });
});
