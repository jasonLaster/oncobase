import { expect, test } from "@playwright/test";
import { ensurePasswordGateSession } from "../gate-auth";
import {
  BIOPSY_ID,
  BIOPSY_IMAGE_COUNT,
  BIOPSY_SERIES_LABEL,
  biopsySeries,
  comparisonSeries,
  diagnosticComparisonsSeed,
  diagnosticStudiesSeed,
  drawAnnotation,
  expectNumberCloseTo,
  expectToolState,
  gotoViewer,
  holdDicomFileRequest,
  installAnnotationApiMock,
  installInteractionProbe,
  installSyntheticDicom,
  interactionProbe,
  latestSavedAnnotation,
  latestSavedAnnotations,
  pointInBox,
  requireNumber,
  resetInteractionProbe,
  seedStudies,
  seededStudySet,
  setRangeValue,
  studySetParam,
} from "./imaging-helpers";
import { requireLocalStack } from "./helpers";

// DICOM imaging journeys. The viewer is exercised against synthetic DICOM files
// served by route mocks (see imaging-helpers.ts), so no patient data or private
// diagnostics root is needed. Study and comparison metadata are seeded into the
// local stack's Convex under a unique study set.
requireLocalStack();
test.describe.configure({ mode: "serial" });

const mid = Math.ceil(BIOPSY_IMAGE_COUNT / 2);
const counter = (index: number) => `${index} / ${BIOPSY_IMAGE_COUNT}`;

test.describe("DICOM imaging journeys", () => {
  test.beforeAll(async ({ request, baseURL }) => {
    await seedStudies(request, baseURL);
  });

  test.beforeEach(async ({ page }) => {
    await ensurePasswordGateSession(page);
    await installSyntheticDicom(page, [biopsySeries, ...comparisonSeries]);
  });

  test("diagnostics imaging page lists the studies and each links to a viewer that boots without the wiki LiveStore", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/diagnostics/imaging?studySet=${seededStudySet}`);

    await expect(page.getByRole("heading", { name: "Imaging" })).toBeVisible();
    const desktopTable = page.getByTestId("diagnostics-desktop-table");
    await expect(desktopTable.getByRole("columnheader", { name: "Reports" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Images" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Comparisons" })).toBeVisible();
    await expect(desktopTable.getByRole("columnheader", { name: "Download" })).toBeVisible();
    await expect(desktopTable.getByRole("link", { name: "Download source bundle" })).toHaveCount(
      diagnosticStudiesSeed.studies.filter((study) => study.downloadHref).length,
    );
    for (const study of diagnosticStudiesSeed.studies) {
      const viewerLink = desktopTable.locator(`a[href="/tools/dicom-viewer?id=${study.id}${studySetParam}"]`);
      await expect(viewerLink).toBeVisible();
      await expect(viewerLink).toHaveAttribute("aria-label", "Images");
    }

    const breastMriRow = desktopTable.getByRole("row", { name: /Apr 1, 2026.*Breast MRI/ });
    await breastMriRow.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByRole("menuitem", { name: "MRI" })).toHaveAttribute(
      "href",
      "/api/file?path=sources%2Fdiagnostics%2F401-breast-mri.pdf",
    );
    await page.keyboard.press("Escape");
    const comparisonStudyCount = new Set(
      diagnosticComparisonsSeed.comparisons.flatMap((comparison) => [comparison.leftStudyId, comparison.rightStudyId]),
    ).size;
    await expect(desktopTable.getByRole("button", { name: "Comparisons" })).toHaveCount(comparisonStudyCount);

    // The viewer is its own island: opening it must not touch the wiki projection.
    let wikiProjectionRequests = 0;
    for (const pattern of ["**/api/wiki/session", "**/api/wiki/manifest**"]) {
      await page.route(pattern, async (route) => {
        wikiProjectionRequests += 1;
        await route.abort();
      });
    }
    const href = await desktopTable.locator(`a[href^="/tools/dicom-viewer?id=${BIOPSY_ID}"]`).getAttribute("href");
    await page.goto(href!, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("diagnostics-sidebar")).toBeVisible();
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(mid));
    expect(wikiProjectionRequests).toBe(0);
  });

  test("the current image lives in the URL, the copied link restores it, and pan, zoom and window-level keep the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tools/dicom-viewer?id=${BIOPSY_ID}&image=6${studySetParam}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(6), { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("image")).toBe("6");
    expect(new URL(page.url()).searchParams.get("seriesId")).toBeTruthy();

    await page.getByRole("button", { name: "Previous image" }).click();
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(5));
    await expect.poll(() => new URL(page.url()).searchParams.get("image")).toBe("5");

    const shareButton = page.getByTestId("dicom-share-current-image");
    await expect(shareButton).toHaveAttribute("title", "Copy current image URL");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    await shareButton.click();
    await expect(shareButton).toHaveAttribute("aria-label", "Copied current image URL");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());

    // The copied link opens the same image on a fresh page.
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    await page.goto(shared, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(5), { timeout: 30_000 });

    // Pan and zoom toggle back to window-level, and switching tools never moves the image.
    await expectToolState(page, { window: true, pan: false, zoom: false });
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 30_000 });
    await installInteractionProbe(page);
    const switches = [
      { name: "Pan", state: { window: false, pan: true, zoom: false } },
      { name: "Pan", state: { window: true, pan: false, zoom: false } },
      { name: "Zoom", state: { window: false, pan: false, zoom: true } },
      { name: "Zoom", state: { window: true, pan: false, zoom: false } },
      { name: "Zoom", state: { window: false, pan: false, zoom: true } },
      { name: "Pan", state: { window: false, pan: true, zoom: false } },
      { name: "W/L", state: { window: true, pan: false, zoom: false } },
    ];
    for (const next of switches) {
      await resetInteractionProbe(page);
      await page.getByRole("button", { name: next.name, exact: true }).click();
      await expectToolState(page, next.state);
      await page.waitForTimeout(300);
      await expect(page.getByTestId("dicom-image-loading")).toBeHidden();
      await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(5));
      expect(await interactionProbe(page)).toEqual({ cameraModified: 0, voiModified: 0 });
    }

    // Images load on demand: the next image shows its own loading state while its file is pending.
    const heldRequest = holdDicomFileRequest(page, "IMG00006.dcm");
    await page.getByRole("button", { name: "Next image" }).click();
    await heldRequest.requestSeen;
    await expect(page.getByTestId("dicom-image-loading")).toBeVisible();
    await expect(page.getByTestId("dicom-image-loading")).toContainText("Loading image 6");
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(6));
    heldRequest.release();
    await expect(page.getByTestId("dicom-image-loading")).toBeHidden();
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(6));
  });

  test("draws an annotation, keeps it per image, and restores it after reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const annotationApi = await installAnnotationApiMock(page);
    await gotoViewer(page);

    await page.getByRole("button", { name: "Draw" }).click();
    await page.getByRole("button", { name: "Arrow" }).click();
    await expect(page.getByTestId("dicom-annotation-tool-arrow")).toHaveAttribute("aria-pressed", "true");

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
    await expect(page.getByTestId("dicom-annotation-handle-move")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-handle-end")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toContainText("Arrow");
    await expect.poll(() => annotationApi.saves.length).toBe(1);
    expect(annotationApi.saves[0]?.annotations[0]).toMatchObject({
      color: "#45a6e8",
      kind: "arrow",
      thickness: 3,
    });

    const savesBeforeInitialStyleChange = annotationApi.saves.length;
    await page.getByTestId("dicom-annotation-color-f87171").click();
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeInitialStyleChange + 1);
    await setRangeValue(page, "dicom-annotation-thickness", "6");
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeInitialStyleChange + 2);
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
    const initialEndX = requireNumber(initialArrow.endX, "initial arrow end x");
    const initialEndY = requireNumber(initialArrow.endY, "initial arrow end y");

    const endDragDelta = { x: 60, y: 35 };
    const savesBeforeEndDrag = annotationApi.saves.length;
    const endHandle = await page.getByTestId("dicom-annotation-handle-end").boundingBox();
    expect(endHandle).not.toBeNull();
    const endHandleCenter = { x: endHandle!.x + endHandle!.width / 2, y: endHandle!.y + endHandle!.height / 2 };
    await page.mouse.move(endHandleCenter.x, endHandleCenter.y);
    await page.mouse.down();
    await page.mouse.move(endHandleCenter.x + endDragDelta.x, endHandleCenter.y + endDragDelta.y);
    await expect(page.getByTestId("dicom-annotation-handle-end-active")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeEndDrag + 1);
    const afterEndDrag = latestSavedAnnotation(annotationApi);
    expectNumberCloseTo(afterEndDrag.endX, initialEndX + endDragDelta.x / box!.width);
    expectNumberCloseTo(afterEndDrag.endY, initialEndY + endDragDelta.y / box!.height);

    // The annotation belongs to its image: gone on the next one, back on return.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(mid + 1));
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(mid));
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(mid), { timeout: 30_000 });
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();
  });

  test("creates a calibrated ruler and deep-links its exact annotation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const annotationApi = await installAnnotationApiMock(page);
    await gotoViewer(page);

    const canvas = page.getByTestId("dicom-annotation-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await drawAnnotation(page, "Ruler", box!, { x: 0.4, y: 0.45 }, { x: 0.57, y: 0.45 });

    await expect(page.getByTestId("dicom-annotation-shape-ruler")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-ruler-label")).toContainText("mm");
    await expect.poll(() => annotationApi.saves.length).toBe(1);
    const ruler = latestSavedAnnotation(annotationApi);
    expect(ruler.kind).toBe("ruler");
    expect(ruler.worldStart).toHaveLength(3);
    expect(ruler.worldEnd).toHaveLength(3);
    const rulerId = String((ruler as { id?: string }).id);
    await expect(page).toHaveURL(new RegExp(`annotation=${encodeURIComponent(rulerId)}`));

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dicom-annotation-shape-ruler")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dicom-annotation-selection")).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`annotation=${encodeURIComponent(rulerId)}`));

    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await expect(page.getByTestId("dicom-annotation-canvas")).toHaveClass(/pointer-events-none/);
    await expect(page.getByTestId("dicom-annotation-selection")).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`annotation=${encodeURIComponent(rulerId)}`));
  });

  test("multi-selects and group-moves annotations, edits text, deletes, and restores with keyboard undo", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const annotationApi = await installAnnotationApiMock(page);
    await gotoViewer(page);

    const canvas = page.getByTestId("dicom-annotation-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await drawAnnotation(page, "Arrow", box!, { x: 0.24, y: 0.28 }, { x: 0.37, y: 0.36 });
    await expect(page.getByTestId("dicom-annotation-shape-arrow")).toBeVisible();
    await expect.poll(() => annotationApi.saves.length).toBe(1);

    await drawAnnotation(page, "Box", box!, { x: 0.52, y: 0.46 }, { x: 0.65, y: 0.62 });
    await expect(page.getByTestId("dicom-annotation-shape-box")).toBeVisible();
    await expect.poll(() => annotationApi.saves.length).toBe(2);

    const arrowMidpoint = pointInBox(box!, 0.305, 0.32);
    await page.keyboard.down("Shift");
    await page.mouse.click(arrowMidpoint.x, arrowMidpoint.y);
    await page.keyboard.up("Shift");

    await expect(page.getByTestId("dicom-annotation-group-selection")).toBeVisible();
    await expect(page.getByTestId("dicom-annotation-selection")).toHaveCount(2);
    await expect(page.getByTestId("dicom-annotation-editor-rail")).toContainText("2 annotations");

    const beforeGroupDrag = latestSavedAnnotations(annotationApi);
    const beforeArrow = beforeGroupDrag.find((annotation) => annotation.kind === "arrow");
    const beforeBox = beforeGroupDrag.find((annotation) => annotation.kind === "box");
    expect(beforeArrow).toBeTruthy();
    expect(beforeBox).toBeTruthy();

    const dragDelta = { x: 48, y: 36 };
    const savesBeforeGroupDrag = annotationApi.saves.length;
    await page.mouse.move(arrowMidpoint.x, arrowMidpoint.y);
    await page.mouse.down();
    await page.mouse.move(arrowMidpoint.x + dragDelta.x, arrowMidpoint.y + dragDelta.y, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeGroupDrag + 1);
    const afterGroupDrag = latestSavedAnnotations(annotationApi);
    const afterArrow = afterGroupDrag.find((annotation) => annotation.kind === "arrow");
    const afterBox = afterGroupDrag.find((annotation) => annotation.kind === "box");
    const dx = dragDelta.x / box!.width;
    const dy = dragDelta.y / box!.height;
    expectNumberCloseTo(afterArrow?.x, requireNumber(beforeArrow?.x, "before arrow x") + dx);
    expectNumberCloseTo(afterArrow?.y, requireNumber(beforeArrow?.y, "before arrow y") + dy);
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

    // Text annotations: inline edit, delete, then undo brings the edited text back.
    await page.getByRole("button", { name: "Draw" }).click();
    await page.getByRole("button", { name: "Text" }).click();
    await expect(page.getByTestId("dicom-annotation-tool-text")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(box!.x + box!.width * 0.12, box!.y + box!.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.26, box!.y + box!.height * 0.86);
    await page.mouse.up();

    const textShape = page.getByTestId("dicom-annotation-shape-text");
    await expect(textShape).toBeVisible();
    const inlineText = page.getByTestId("dicom-annotation-inline-text");
    await expect(page.getByTestId("dicom-annotation-text")).toHaveValue("Note");
    await inlineText.fill("Edited MRI note");
    await expect(textShape).toContainText("Edited MRI note");
    await expect.poll(() => annotationApi.saves.at(-1)?.annotations.some((a) => a.text === "Edited MRI note")).toBe(true);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    const savesBeforeTextDelete = annotationApi.saves.length;
    await page.keyboard.press("Backspace");
    await expect(textShape).toHaveCount(0);
    await expect.poll(() => annotationApi.saves.length).toBe(savesBeforeTextDelete + 1);
    await page.keyboard.press(`${modifier}+Z`);
    await expect(textShape).toContainText("Edited MRI note");
    await expect.poll(() => annotationApi.saves.at(-1)?.annotations.some((a) => a.text === "Edited MRI note")).toBe(true);
  });

  test("the paired MRI comparison renders both stacks with usable canvases", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/tools/dicom-compare?comparison=mri-comparison-2026-04-01-vs-2026-06-26${studySetParam}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "April 1 vs June 26 breast MRI" })).toBeVisible();
    await expect(page.getByTestId("dicom-compare-pair-phase-2-subtraction")).toContainText("Phase-2 subtraction");
    for (const [side, count] of [
      ["left", comparisonSeries[0]!.count],
      ["right", comparisonSeries[1]!.count],
    ] as const) {
      const canvas = page.getByTestId(`dicom-compare-${side}-viewport`).locator("canvas");
      await expect(canvas).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId(`dicom-compare-${side}-loading`)).toBeHidden({ timeout: 45_000 });
      await expect(page.getByTestId(`dicom-compare-${side}-counter`)).toContainText(`/ ${count}`);
      const size = await canvas.boundingBox();
      expect(size?.width).toBeGreaterThan(150);
      expect(size?.height).toBeGreaterThanOrEqual(200);
    }
    await expect(page.getByTestId("dicom-compare-match-state")).toContainText(/z|fallback/i);
    await expect(page.getByText("Marked overall improvement")).toBeVisible();
    await expect(page.getByTestId("dicom-compare-precomputed-panel")).toContainText("Annotated subtraction report slices");

    // A loaded counter alone once stayed green while the canvases had zero height:
    // step back a matched slice and make sure the controls do not overlap the images.
    const leftCounter = page.getByTestId("dicom-compare-left-counter");
    const before = await leftCounter.innerText();
    const previous = page.getByRole("button", { name: "Previous matched slice" });
    await previous.click();
    await expect(leftCounter).not.toHaveText(before);
    const images = await page.getByTestId("dicom-compare-viewports").boundingBox();
    const control = await previous.boundingBox();
    expect(control!.y).toBeGreaterThanOrEqual(images!.y + images!.height);
  });

  test("mobile portrait uses a bottom sheet and mobile landscape gives the image the full width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoViewer(page);
    await expect(page.getByTestId("dicom-slice-counter")).toHaveText(counter(mid), { timeout: 30_000 });

    await expect(page.locator('[data-test-id="dicom-series-panel"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="mobile-page-header"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-mobile-study-trigger"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("dicom-mobile-series-bar")).toContainText(BIOPSY_SERIES_LABEL);

    const controls = await page.getByTestId("dicom-controls").boundingBox();
    const frame = await page.getByTestId("dicom-viewport-frame").boundingBox();
    const seriesBar = await page.getByTestId("dicom-mobile-series-bar").boundingBox();
    expect(controls?.y).toBeLessThan(frame?.y ?? 0);
    expect(seriesBar?.y).toBeGreaterThan(frame?.y ?? 0);

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

    await page.setViewportSize({ width: 844, height: 390 });
    await gotoViewer(page);
    await expect(page.getByTestId("mobile-page-header")).toBeHidden();
    await expect(page.locator('[data-test-id="diagnostics-sidebar"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-series-panel"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-test-id="dicom-stack-panel"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("dicom-mobile-series-bar")).toBeVisible();
    const frameBox = await page.getByTestId("dicom-viewport-frame").boundingBox();
    expect(frameBox?.width).toBeGreaterThan(800);
    expect(frameBox?.height).toBeGreaterThan(280);
    const canvasState = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-test-id="dicom-cornerstone-viewport"] canvas');
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
});
