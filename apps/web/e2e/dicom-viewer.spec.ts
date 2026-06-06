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
  await expect(
    page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("dicom-image-loading")).toBeHidden({
    timeout: 30_000,
  });
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
  test("diagnostics page links each biopsy shortcut to the viewer", async ({ page }) => {
    await page.goto("/diagnostics");

    await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    const desktopTable = page.getByTestId("diagnostics-desktop-table");
    await expect(desktopTable.getByRole("columnheader", { name: "Reports" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "View images" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Download" })).toBeVisible();
    await expect(desktopTable.getByRole("link", { name: "Download" })).toHaveCount(4);
    for (const biopsy of biopsyLinks) {
      const viewerLink = desktopTable.locator(
        `a[href="/tools/dicom-viewer?id=${biopsy.id}"]`
      );

      await expect(viewerLink).toBeVisible();
      await expect(viewerLink).toContainText("View images");
      await expect(viewerLink).toHaveAttribute(
        "href",
        `/tools/dicom-viewer?id=${biopsy.id}`,
      );
    }

    const breastMriRow = desktopTable.getByRole("row", {
      name: /Apr 1, 2026.*Breast MRI/,
    });
    await breastMriRow.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByRole("menuitem", { name: "MRI report" })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Breast biopsy report" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Axilla biopsy report" }),
    ).toBeVisible();
  });

  test("diagnostics page uses a compact mobile study list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/diagnostics");

    const mobileList = page.getByTestId("diagnostics-mobile-list");
    await expect(mobileList).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
    await expect(
      mobileList.getByRole("link", { name: /View images/ }),
    ).toHaveCount(biopsyLinks.length);
    await expect(
      mobileList.getByRole("link", { name: /View images/ }).first(),
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
