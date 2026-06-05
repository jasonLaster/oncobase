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
const petctReportPath = "diagnostics/viewer-upload/03-27-petct/report.pdf";

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
    for (const biopsy of biopsyLinks) {
      const viewerLink = page.locator(
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

  test("diagnostic report PDFs support byte-range loading", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(
      `${baseURL}/api/file?path=${encodeURIComponent(petctReportPath)}`,
      {
        headers: {
          Range: "bytes=0-99",
        },
      },
    );

    expect(res.status()).toBe(206);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect(res.headers()["content-disposition"]).toContain("inline");
    expect(res.headers()["content-length"]).toBe("100");
    expect(res.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
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

    await page.getByTestId("dicom-collapse-guardrails").click();

    await expect(page.locator("[data-sidebar-layout]")).toHaveAttribute(
      "data-sidebar-state",
      "collapsed",
    );
    await expect(page.getByTestId("dicom-stack-panel")).toBeHidden();

    await page.getByTestId("dicom-toggle-stack-rail").click();
    await expect(page.getByTestId("dicom-stack-panel")).toBeVisible();
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
