import { expect, test, type Page } from "@playwright/test";

/**
 * Verifies the DICOM viewer contract documented in
 * apps/web/specs/dicom-viewer.md.
 */

const biopsyLinks = [
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
const breastMriReportPath =
  "sources/diagnostics/03-13-breast-biopsy-report.pdf";
const liveDiagnosticsReportLinks = [
  "/sources/diagnostics/04-01-breast-mri",
  "/sources/diagnostics/03-27-petct",
  "/sources/diagnostics/03-20-ultrasound",
  "/sources/diagnostics/02-20-ultrasound",
  "/sources/diagnostics/03-23-us-axilla-core-biopsy",
  "/api/file?path=sources%2Fdiagnostics%2F03-13-breast-biopsy-report.pdf",
];

async function gotoViewer(page: Page, biopsyId = "biopsy-2026-04-10") {
  await page.goto(`/tools/dicom-viewer?id=${biopsyId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
  await expect(page.getByRole("button", { name: "W/L", exact: true })).toBeVisible();
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
  test("diagnostics page links each biopsy shortcut to the viewer", async ({ page }) => {
    await page.goto("/diagnostics");

    await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    const desktopTable = page.getByTestId("diagnostics-desktop-table");
    for (const biopsy of biopsyLinks) {
      const viewerLink = desktopTable.locator(
        `a[href="/tools/dicom-viewer?id=${biopsy.id}"]`
      );

      await expect(viewerLink).toBeVisible();
      await expect(viewerLink).toContainText("DICOM viewer");
      await expect(viewerLink).toHaveAttribute(
        "href",
        `/tools/dicom-viewer?id=${biopsy.id}`,
      );
    }
  });

  test("diagnostics page uses a compact mobile study list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/diagnostics");

    const mobileList = page.getByTestId("diagnostics-mobile-list");
    await expect(mobileList).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
    await expect(
      mobileList.getByRole("link", { name: /DICOM viewer/ }),
    ).toHaveCount(biopsyLinks.length);
    await expect(
      mobileList.getByRole("link", { name: /DICOM viewer/ }).first(),
    ).toHaveAttribute("href", "/tools/dicom-viewer?id=biopsy-2026-04-10");
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

  test("diagnostics routes replace the file tree with biopsy shortcuts", async ({
    page,
  }) => {
    await page.goto("/diagnostics");

    const sidebar = page.getByTestId("diagnostics-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link")).toHaveCount(biopsyLinks.length);
    await expect(sidebar).not.toContainText("Diagnostics");
    await expect(sidebar).not.toContainText("Pathology report");
    await expect(sidebar).not.toContainText("project management");

    for (const biopsy of biopsyLinks) {
      await expect(sidebar.getByRole("link", { name: biopsy.title })).toHaveAttribute(
        "href",
        `/tools/dicom-viewer?id=${biopsy.id}`,
      );
    }

    await page.goto("/tools/dicom-viewer?id=biopsy-2026-03-23");
    await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "March 13 biopsy" }),
    ).toHaveAttribute("href", "/tools/dicom-viewer?id=biopsy-2026-03-13");

    const seriesPanel = page.getByTestId("dicom-series-panel");
    await expect(seriesPanel).toContainText("2026-03-23");
    await expect(seriesPanel).not.toContainText("2026-04-10");
    await expect(page.getByTestId("dicom-pathology-report-link")).toHaveAttribute(
      "href",
      "/sources/diagnostics/03-23-us-axilla-core-biopsy",
    );
    await expect(page.getByTestId("dicom-pathology-report-link")).toContainText(
      "Pathology report",
    );
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

    const frameBox = await page.getByTestId("dicom-viewport-frame").boundingBox();
    expect(frameBox?.width).toBeGreaterThan(800);
    expect(frameBox?.height).toBeGreaterThan(320);
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText("5 / 9", {
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
    expect(canvasState.height).toBeGreaterThan(300);
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
    await expect(page.locator('[data-test-id="mobile-ask-wiki"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("dicom-mobile-study-trigger")).toBeVisible();

    const toolsRow = await page.getByTestId("dicom-tools-row").boundingBox();
    const cineRow = await page.getByTestId("dicom-cine-row").boundingBox();
    expect(toolsRow?.y).toBeLessThan(cineRow?.y ?? 0);

    await page.getByTestId("dicom-mobile-study-trigger").click();
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

  test("next image shows loading state while the requested DICOM file is pending", async ({
    page,
  }) => {
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
