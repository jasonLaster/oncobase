import { createRequire } from "node:module";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const { diagnosticComparisonsSeed } = createRequire(import.meta.url)(
  "../../web/scripts/fixtures/diagnostic-comparisons-seed.ts",
) as typeof import("../../web/scripts/fixtures/diagnostic-comparisons-seed");
const { diagnosticStudiesSeed } = createRequire(import.meta.url)(
  "../../web/scripts/fixtures/diagnostic-studies-seed.ts",
) as typeof import("../../web/scripts/fixtures/diagnostic-studies-seed");

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
// Deployed targets (preview shards set PLAYWRIGHT_BASE_URL) run production
// builds, which strip test studySet params from hrefs by design — seeded
// local-mode assertions only hold against the local dev server.
const isProdRun =
  process.env.TEST_ENV === "prod" || Boolean(process.env.PLAYWRIGHT_BASE_URL);
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

type AnnotationApiMock = Awaited<ReturnType<typeof installAnnotationApiMock>>;
type TestBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

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

async function dragResizeHandle(page: Page, handle: Locator, deltaX: number) {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const start = {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + deltaX, start.y, { steps: 6 });
  await page.mouse.up();
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

async function installAnnotationApiMock(page: Page) {
  const savedByImage = new Map<string, unknown[]>();
  const saves: Array<{
    annotations: Array<{
      color?: string;
      endX?: number;
      endY?: number;
      fontSize?: number;
      kind?: string;
      text?: string;
      thickness?: number;
      width?: number;
      x?: number;
      y?: number;
    }>;
    imageKey: string;
    imagePath: string;
    seriesKey: string;
  }> = [];

  await page.route("**/api/dicom/annotations**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const url = new URL(request.url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          seriesKey: url.searchParams.get("seriesKey") ?? "",
          images: Array.from(savedByImage.entries()).map(
            ([imageKey, annotations]) => ({
              annotations,
              imageKey,
              imagePath: imageKey,
            }),
          ),
        }),
      });
      return;
    }

    if (request.method() === "PUT") {
      const body = request.postDataJSON() as {
        annotations?: unknown[];
        imageKey?: string;
        imagePath?: string;
        seriesKey?: string;
      };
      if (body.imageKey && Array.isArray(body.annotations)) {
        savedByImage.set(body.imageKey, body.annotations);
        saves.push({
          annotations: body.annotations as Array<{
            color?: string;
            endX?: number;
            endY?: number;
            fontSize?: number;
            kind?: string;
            text?: string;
            thickness?: number;
            width?: number;
            x?: number;
            y?: number;
          }>,
          imageKey: body.imageKey,
          imagePath: body.imagePath ?? body.imageKey,
          seriesKey: body.seriesKey ?? "",
        });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ updatedAt: Date.now() }),
      });
      return;
    }

    await route.fulfill({ status: 405 });
  });

  return { savedByImage, saves };
}

async function setRangeValue(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

function pointInBox(box: TestBox, x: number, y: number) {
  return {
    x: box.x + box.width * x,
    y: box.y + box.height * y,
  };
}

async function drawAnnotation(
  page: Page,
  kind: "Arrow" | "Box" | "Circle" | "Text",
  box: TestBox,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.getByRole("button", { name: "Draw" }).click();
  await page.getByRole("button", { name: kind }).click();
  const drawStart = pointInBox(box, start.x, start.y);
  const drawEnd = pointInBox(box, end.x, end.y);
  await page.mouse.move(drawStart.x, drawStart.y);
  await page.mouse.down();
  await page.mouse.move(drawEnd.x, drawEnd.y);
  await page.mouse.up();
}

function latestSavedAnnotation(annotationApi: AnnotationApiMock) {
  const annotation = annotationApi.saves.at(-1)?.annotations[0];
  expect(annotation).toBeTruthy();
  return annotation!;
}

function latestSavedAnnotations(annotationApi: AnnotationApiMock) {
  const annotations = annotationApi.saves.at(-1)?.annotations;
  expect(annotations).toBeTruthy();
  return annotations!;
}

function expectNumberCloseTo(
  value: number | undefined,
  expected: number,
  tolerance = 0.008,
) {
  expect(value).toBeDefined();
  expect(Math.abs(value! - expected)).toBeLessThanOrEqual(tolerance);
}

function requireNumber(value: number | undefined, label: string) {
  expect(value, label).toBeDefined();
  return value!;
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

  test("diagnostics imaging page uses the normal sidebar and viewer uses biopsy shortcuts", async ({
    page,
  }) => {
    await page.goto(`/diagnostics/imaging${seededStudySetQuery}`);

    const sidebar = page.locator('[data-test-id="wiki-sidebar"]:visible').first();
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
    // Cold LiveStore hydration on a non-wiki route can take a while; match the
    // suite's other long-load assertions.
    await expect(sidebar).toContainText("project management", { timeout: 60_000 });

    await page.goto(`/tools/dicom-viewer?id=biopsy-2026-03-23${seededStudySetParam}`);
    // Store boot after many prior tests can fail transiently (OPFS/session
    // state churn); recover deterministically by resetting local data once.
    const viewport = page.getByTestId("dicom-cornerstone-viewport");
    const resetButton = page.getByRole("button", { name: "Reset local data & reload" });
    await Promise.race([
      viewport.waitFor({ timeout: 30_000 }).catch(() => {}),
      resetButton.waitFor({ timeout: 30_000 }).catch(() => {}),
    ]);
    if (await resetButton.isVisible().catch(() => false)) {
      await resetButton.click();
    }
    await expect(viewport).toBeVisible({ timeout: 60_000 });
    const viewerSidebar = page.getByTestId("diagnostics-sidebar");
    // Post-reset the store re-syncs the full corpus before the rail hydrates.
    await expect(viewerSidebar).toBeVisible({ timeout: 60_000 });
    await expect(viewerSidebar.getByRole("link")).toHaveCount(biopsyLinks.length + 1, {
      timeout: 30_000,
    });
    await expect(
      viewerSidebar.getByRole("link", { name: "March 13 biopsy" }),
    ).toHaveAttribute(
      "href",
      `/tools/dicom-viewer?id=biopsy-2026-03-13${seededStudySetParam}`,
    );

    const seriesPanel = page.getByTestId("dicom-series-panel");
    await expect(seriesPanel).toContainText("45 images");
    await expect(seriesPanel).not.toContainText("3-23 - US Axilla biopsy");
    await expect(seriesPanel).not.toContainText("4-10 biopsy");
    await expect(page.getByTestId("dicom-pathology-report-link")).toHaveAttribute(
      "href",
      "/sources/diagnostics/03-23-us-axilla-core-biopsy",
    );
    await expect(page.getByTestId("dicom-pathology-report-link")).toContainText(
      "Pathology report",
    );
    const backLink = viewerSidebar.getByTestId("dicom-back-to-imaging");
    await expect(backLink).toHaveAttribute(
      "href",
      `/diagnostics/imaging${seededStudySetQuery}`,
    );
    await expect(seriesPanel.getByTestId("dicom-back-to-imaging")).toHaveCount(0);
    await expect(
      page.getByTestId("dicom-tools-row").getByTestId("dicom-back-to-imaging"),
    ).toHaveCount(0);
    await backLink.click();
    await expect(page.getByRole("heading", { name: "Imaging" })).toBeVisible();
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

  test("stores the current image in the URL and copies a shareable image link", async ({
    page,
  }) => {
    await page.goto(
      `/tools/dicom-viewer?id=biopsy-2026-04-10&image=6${seededStudySetParam}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
    await expect(
      page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9", {
      timeout: 30_000,
    });

    const initialUrl = new URL(page.url());
    expect(initialUrl.searchParams.get("image")).toBe("6");
    expect(initialUrl.searchParams.get("seriesId")).toBeTruthy();

    await page.getByRole("button", { name: "Previous image" }).click();
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("image"))
      .toBe("5");

    const shareButton = page.getByTestId("dicom-share-current-image");
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toHaveAttribute("title", "Copy current image URL");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    await shareButton.click();
    await expect(shareButton).toHaveAttribute("aria-label", "Copied current image URL");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(page.url());
  });

  for (const biopsy of biopsyLinks) {
    test(`viewer selects the ${biopsy.id} image stack`, async ({ page }) => {
      await gotoViewer(page, biopsy.id);

      await expect(page.getByTestId("dicom-slice-counter")).toHaveText(
        biopsy.counter,
        { timeout: 30_000 },
      );
      await expect(page.locator("dd", { hasText: biopsy.directory }).first()).toBeVisible();
      await expect(page.getByTestId("dicom-series-panel")).not.toContainText(
        biopsy.directory.split("/")[0],
      );
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

  test("resizes the desktop series and stack rails", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoViewer(page);

    const seriesPanel = page.getByTestId("dicom-series-panel");
    const stackPanel = page.getByTestId("dicom-stack-panel");
    const seriesHandle = page.getByTestId("dicom-series-rail-resize-handle");
    const stackHandle = page.getByTestId("dicom-stack-rail-resize-handle");

    await expect(seriesHandle).toBeVisible();
    await expect(stackHandle).toBeVisible();

    const initialSeriesWidth = (await seriesPanel.boundingBox())?.width ?? 0;
    await dragResizeHandle(page, seriesHandle, 72);
    await expect
      .poll(async () => (await seriesPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialSeriesWidth + 50);

    const initialStackWidth = (await stackPanel.boundingBox())?.width ?? 0;
    await dragResizeHandle(page, stackHandle, -64);
    await expect
      .poll(async () => (await stackPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialStackWidth + 40);
    await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
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

  test("draws and reloads annotations for an image inside a DICOM series", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const annotationApi = await installAnnotationApiMock(page);
    await gotoViewer(page);

    const toolbarBox = await page.getByTestId("dicom-annotation-toolbar").boundingBox();
    expect(toolbarBox?.height).toBeLessThan(52);
    expect(toolbarBox?.width).toBeLessThan(280);
    await expect(page.getByTestId("dicom-annotation-tool-layers")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-tool-delete")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-tool-undo")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-tool-style")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-tool-clear")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-save-status")).toHaveCount(0);

    await page.getByRole("button", { name: "Draw" }).click();
    await page.getByRole("button", { name: "Arrow" }).click();

    const canvas = page.getByTestId("dicom-annotation-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const drawStart = pointInBox(box!, 0.34, 0.34);
    const drawEnd = pointInBox(box!, 0.58, 0.48);
    await page.mouse.move(drawStart.x, drawStart.y);
    await page.mouse.down();
    await page.mouse.move(drawEnd.x, drawEnd.y);
    await page.mouse.up();

    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-selection")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-selection")).not.toHaveAttribute(
      "stroke-dasharray",
      /.+/,
    );
    await expect(page.getByTestId("dicom-annotation-selection")).toHaveAttribute(
      "stroke",
      "#2f80ed",
    );
    await expect(page.getByTestId("dicom-annotation-handle-start")).toHaveAttribute(
      "fill",
      "#f8fafc",
    );
    await expect(page.getByTestId("dicom-annotation-handle-start")).toHaveAttribute(
      "stroke",
      "#2f80ed",
    );
    await expect(page.getByTestId("dicom-annotation-handle-move")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-handle-end")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toContainText(
      "Arrow",
    );
    await expect(page.getByTestId("dicom-stack-metadata")).toHaveCount(0);
    await expect.poll(() => annotationApi.saves.length).toBe(1);
    expect(annotationApi.saves[0]?.annotations[0]).toMatchObject({
      color: "#45a6e8",
      kind: "arrow",
      thickness: 3,
    });

    const savesBeforeInitialStyleChange = annotationApi.saves.length;
    await page.getByTestId("dicom-annotation-color-f87171").click();
    await expect.poll(() => annotationApi.saves.length).toBe(
      savesBeforeInitialStyleChange + 1,
    );
    await setRangeValue(page, "dicom-annotation-thickness", "6");
    await expect.poll(() => annotationApi.saves.length).toBe(
      savesBeforeInitialStyleChange + 2,
    );
    expect(annotationApi.saves.at(-1)?.annotations[0]).toMatchObject({
      color: "#f87171",
      kind: "arrow",
      thickness: 6,
    });
    const initialArrow = latestSavedAnnotation(annotationApi);
    expectNumberCloseTo(initialArrow.x, 0.34);
    expectNumberCloseTo(initialArrow.y, 0.34);
    expectNumberCloseTo(initialArrow.endX, 0.58);
    expectNumberCloseTo(initialArrow.endY, 0.48);
    const initialStartX = requireNumber(initialArrow.x, "initial arrow start x");
    const initialStartY = requireNumber(initialArrow.y, "initial arrow start y");
    const initialEndX = requireNumber(initialArrow.endX, "initial arrow end x");
    const initialEndY = requireNumber(initialArrow.endY, "initial arrow end y");

    const endDragDelta = {
      x: 60,
      y: 35,
    };
    const savesBeforeEndDrag = annotationApi.saves.length;
    const endHandle = await page.getByTestId("dicom-annotation-handle-end").boundingBox();
    expect(endHandle).not.toBeNull();
    const endHandleCenter = {
      x: endHandle!.x + endHandle!.width / 2,
      y: endHandle!.y + endHandle!.height / 2,
    };
    await page.mouse.move(endHandleCenter.x, endHandleCenter.y);
    await page.mouse.down();
    await page.mouse.move(
      endHandleCenter.x + endDragDelta.x,
      endHandleCenter.y + endDragDelta.y,
    );
    await expect(page.getByTestId("dicom-annotation-handle-end-active")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeEndDrag + 1);
    const afterEndDrag = latestSavedAnnotation(annotationApi);
    expectNumberCloseTo(afterEndDrag.x, initialStartX);
    expectNumberCloseTo(afterEndDrag.y, initialStartY);
    expectNumberCloseTo(
      afterEndDrag.endX,
      initialEndX + endDragDelta.x / box!.width,
    );
    expectNumberCloseTo(
      afterEndDrag.endY,
      initialEndY + endDragDelta.y / box!.height,
    );
    const afterEndStartX = requireNumber(afterEndDrag.x, "tip drag keeps start x");
    const afterEndStartY = requireNumber(afterEndDrag.y, "tip drag keeps start y");
    const afterEndX = requireNumber(afterEndDrag.endX, "tip drag end x");
    const afterEndY = requireNumber(afterEndDrag.endY, "tip drag end y");

    const startDragDelta = {
      x: -45,
      y: -30,
    };
    const savesBeforeStartDrag = annotationApi.saves.length;
    const startHandle = await page
      .getByTestId("dicom-annotation-handle-start")
      .boundingBox();
    expect(startHandle).not.toBeNull();
    const startHandleCenter = {
      x: startHandle!.x + startHandle!.width / 2,
      y: startHandle!.y + startHandle!.height / 2,
    };
    await page.mouse.move(startHandleCenter.x, startHandleCenter.y);
    await page.mouse.down();
    await page.mouse.move(
      startHandleCenter.x + startDragDelta.x,
      startHandleCenter.y + startDragDelta.y,
    );
    await expect(page.getByTestId("dicom-annotation-handle-start-active")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeStartDrag + 1);
    const afterStartDrag = latestSavedAnnotation(annotationApi);
    expectNumberCloseTo(
      afterStartDrag.x,
      afterEndStartX + startDragDelta.x / box!.width,
    );
    expectNumberCloseTo(
      afterStartDrag.y,
      afterEndStartY + startDragDelta.y / box!.height,
    );
    expectNumberCloseTo(afterStartDrag.endX, afterEndX);
    expectNumberCloseTo(afterStartDrag.endY, afterEndY);
    const afterStartX = requireNumber(afterStartDrag.x, "anchor drag start x");
    const afterStartY = requireNumber(afterStartDrag.y, "anchor drag start y");
    const afterStartEndX = requireNumber(afterStartDrag.endX, "anchor drag end x");
    const afterStartEndY = requireNumber(afterStartDrag.endY, "anchor drag end y");

    const wholeArrowDelta = {
      x: 10,
      y: 12,
    };
    const grabPoint = {
      x: afterStartX + (afterStartEndX - afterStartX) * 0.35,
      y: afterStartY + (afterStartEndY - afterStartY) * 0.35,
    };
    const grabPixel = pointInBox(box!, grabPoint.x, grabPoint.y);
    const savesBeforeWholeDrag = annotationApi.saves.length;
    await page.mouse.move(grabPixel.x, grabPixel.y);
    await page.mouse.down();
    await page.mouse.move(
      grabPixel.x + wholeArrowDelta.x,
      grabPixel.y + wholeArrowDelta.y,
    );
    await expect(page.getByTestId("dicom-annotation-handle-move-active")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeWholeDrag + 1);
    const afterWholeDrag = latestSavedAnnotation(annotationApi);
    expectNumberCloseTo(
      afterWholeDrag.x,
      afterStartX + wholeArrowDelta.x / box!.width,
    );
    expectNumberCloseTo(
      afterWholeDrag.y,
      afterStartY + wholeArrowDelta.y / box!.height,
    );
    expectNumberCloseTo(
      afterWholeDrag.endX,
      afterStartEndX + wholeArrowDelta.x / box!.width,
    );
    expectNumberCloseTo(
      afterWholeDrag.endY,
      afterStartEndY + wholeArrowDelta.y / box!.height,
    );

    await expect(page.getByTestId("dicom-annotation-layers-panel")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-style-panel")).toBeVisible();
    const savesBeforeStyleChange = annotationApi.saves.length;
    await setRangeValue(page, "dicom-annotation-thickness", "8");
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeStyleChange + 1);
    expect(annotationApi.saves.at(-1)?.annotations[0]).toMatchObject({
      kind: "arrow",
      thickness: 8,
    });

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("6 / 9");
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toHaveCount(0);

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9");
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
    await expect(
      page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();
  });

  test("multi-selects annotations with shift and drag-selects before group moves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const annotationApi = await installAnnotationApiMock(page);
    await gotoViewer(page);

    const canvas = page.getByTestId("dicom-annotation-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await drawAnnotation(
      page,
      "Arrow",
      box!,
      { x: 0.24, y: 0.28 },
      { x: 0.37, y: 0.36 },
    );
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();
    await expect.poll(() => annotationApi.saves.length).toBe(1);

    await drawAnnotation(
      page,
      "Box",
      box!,
      { x: 0.52, y: 0.46 },
      { x: 0.65, y: 0.62 },
    );
    await expect(page.getByTestId("dicom-annotation-shape-box")).toBeVisible();
    await expect.poll(() => annotationApi.saves.length).toBe(2);

    const arrowMidpoint = pointInBox(box!, 0.305, 0.32);
    await page.keyboard.down("Shift");
    await page.mouse.click(arrowMidpoint.x, arrowMidpoint.y);
    await page.keyboard.up("Shift");

    await expect(page.getByTestId("dicom-annotation-group-selection")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-selection")).toHaveCount(2);
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toContainText(
      "2 annotations",
    );
    await expect(page.getByTestId("dicom-stack-metadata")).toHaveCount(0);

    const beforeGroupDrag = latestSavedAnnotations(annotationApi);
    const beforeArrow = beforeGroupDrag.find((annotation) => annotation.kind === "arrow");
    const beforeBox = beforeGroupDrag.find((annotation) => annotation.kind === "box");
    expect(beforeArrow).toBeTruthy();
    expect(beforeBox).toBeTruthy();

    const dragDelta = { x: 48, y: 36 };
    const savesBeforeGroupDrag = annotationApi.saves.length;
    await page.mouse.move(arrowMidpoint.x, arrowMidpoint.y);
    await page.mouse.down();
    await page.mouse.move(
      arrowMidpoint.x + dragDelta.x,
      arrowMidpoint.y + dragDelta.y,
      { steps: 6 },
    );
    await page.mouse.up();

    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeGroupDrag + 1);
    const afterGroupDrag = latestSavedAnnotations(annotationApi);
    const afterArrow = afterGroupDrag.find((annotation) => annotation.kind === "arrow");
    const afterBox = afterGroupDrag.find((annotation) => annotation.kind === "box");
    expect(afterArrow).toBeTruthy();
    expect(afterBox).toBeTruthy();
    const dx = dragDelta.x / box!.width;
    const dy = dragDelta.y / box!.height;
    expectNumberCloseTo(afterArrow?.x, requireNumber(beforeArrow?.x, "before arrow x") + dx);
    expectNumberCloseTo(afterArrow?.y, requireNumber(beforeArrow?.y, "before arrow y") + dy);
    expectNumberCloseTo(
      afterArrow?.endX,
      requireNumber(beforeArrow?.endX, "before arrow end x") + dx,
    );
    expectNumberCloseTo(
      afterArrow?.endY,
      requireNumber(beforeArrow?.endY, "before arrow end y") + dy,
    );
    expectNumberCloseTo(afterBox?.x, requireNumber(beforeBox?.x, "before box x") + dx);
    expectNumberCloseTo(afterBox?.y, requireNumber(beforeBox?.y, "before box y") + dy);

    const marqueeStart = pointInBox(box!, 0.18, 0.2);
    const marqueeEnd = pointInBox(box!, 0.72, 0.72);
    await page.mouse.move(marqueeStart.x, marqueeStart.y);
    await page.mouse.down();
    await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 6 });
    await expect(page.getByTestId("dicom-annotation-selection-marquee")).toBeVisible();
    await page.mouse.up();

    await expect(page.getByTestId("dicom-annotation-group-selection")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-selection")).toHaveCount(2);
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toContainText(
      "2 annotations",
    );

    const savesBeforeDelete = annotationApi.saves.length;
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toHaveCount(0);
    await expect(page.getByTestId("dicom-annotation-shape-box")).toHaveCount(0);
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeDelete + 1);
    expect(annotationApi.saves.at(-1)?.annotations).toHaveLength(0);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+Z`);
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-shape-box")).toBeVisible();
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeDelete + 2);
    expect(annotationApi.saves.at(-1)?.annotations).toHaveLength(2);
  });

  test("edits text annotations, deletes selections, and restores with keyboard undo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const annotationApi = await installAnnotationApiMock(page);
    await gotoViewer(page);

    await page.getByRole("button", { name: "Draw" }).click();
    await page.getByRole("button", { name: "Text" }).click();

    const canvas = page.getByTestId("dicom-annotation-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.42, box!.y + box!.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.56, box!.y + box!.height * 0.5);
    await page.mouse.up();

    const textShape = page.getByTestId("dicom-annotation-shape-text");
    await expect(textShape).toBeVisible();
    const inlineText = page.getByTestId("dicom-annotation-inline-text");
    await expect(inlineText).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toContainText(
      "Text",
    );
    await expect(page.getByTestId("dicom-annotation-style-panel")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-text")).toHaveValue("Note");
    await expect(page.getByTestId("dicom-stack-metadata")).toHaveCount(0);
    await expect.poll(() => annotationApi.saves.length).toBe(1);
    expect(annotationApi.saves.at(-1)?.annotations[0]).toMatchObject({
      kind: "text",
      text: "Note",
    });

    await inlineText.fill("Edited MRI note");
    await expect(textShape).toContainText("Edited MRI note");
    await expect(page.getByTestId("dicom-annotation-text")).toHaveValue(
      "Edited MRI note",
    );
    await expect.poll(() => annotationApi.saves.length).toBe(2);
    expect(annotationApi.saves.at(-1)?.annotations[0]).toMatchObject({
      kind: "text",
      text: "Edited MRI note",
    });

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.press("Backspace");
    await expect(textShape).toHaveCount(0);
    await expect.poll(() => annotationApi.saves.length).toBe(3);
    expect(annotationApi.saves.at(-1)?.annotations).toHaveLength(0);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+Z`);
    await expect(textShape).toBeVisible();
    await expect(textShape).toContainText("Edited MRI note");
    await expect.poll(() => annotationApi.saves.length).toBe(4);
    expect(annotationApi.saves.at(-1)?.annotations[0]).toMatchObject({
      kind: "text",
      text: "Edited MRI note",
    });

    await page.getByTestId("dicom-annotation-text-hit-target").dblclick();
    await expect(inlineText).toBeVisible();
    await inlineText.fill("Second inline note");
    await expect(textShape).toContainText("Second inline note");
    await expect.poll(() => annotationApi.saves.length).toBe(5);
    expect(annotationApi.saves.at(-1)?.annotations[0]).toMatchObject({
      kind: "text",
      text: "Second inline note",
    });

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.press("Delete");
    await expect(textShape).toHaveCount(0);
    await expect.poll(() => annotationApi.saves.length).toBe(6);
    expect(annotationApi.saves.at(-1)?.annotations).toHaveLength(0);
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
