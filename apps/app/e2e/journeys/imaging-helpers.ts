import { createRequire } from "node:module";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { passwordGateCookie } from "../gate-auth";

/**
 * Shared DICOM journey helpers. The viewer reads its pixels from `/api/dicom/*`.
 * On a dev server that route can only read a private on-disk diagnostics root
 * (it uses Bun.file, which the Vite dev server does not have), so the journeys
 * serve small synthetic but fully valid DICOM files instead: no patient data,
 * no root directory, same decoder path as production.
 */

const { diagnosticStudiesSeed } = createRequire(import.meta.url)(
  "../../scripts/fixtures/diagnostic-studies-seed.ts",
) as typeof import("../../scripts/fixtures/diagnostic-studies-seed");
const { diagnosticComparisonsSeed } = createRequire(import.meta.url)(
  "../../scripts/fixtures/diagnostic-comparisons-seed.ts",
) as typeof import("../../scripts/fixtures/diagnostic-comparisons-seed");

export { diagnosticStudiesSeed, diagnosticComparisonsSeed };

export const seededStudySet = `playwright-dicom-${Date.now()}`;
export const studySetParam = `&studySet=${seededStudySet}`;

export const BIOPSY_ID = "biopsy-2026-04-10";
export const BIOPSY_SERIES_LABEL = "2026-04-10 · US · US Axilla Core BX RT IMGUS0248 · Series 2";
export const BIOPSY_IMAGE_COUNT = 9;

export async function seedStudies(request: APIRequestContext, baseURL: string | undefined) {
  const appBaseURL = baseURL ?? "http://localhost:3000";
  const cookie = await passwordGateCookie(request);
  for (const [path, data] of [
    ["/api/test/diagnostic-studies", { studySet: seededStudySet, studies: diagnosticStudiesSeed.studies }],
    ["/api/test/dicom-comparisons", { comparisonSet: seededStudySet, comparisons: diagnosticComparisonsSeed.comparisons }],
  ] as const) {
    const response = await request.post(`${appBaseURL}${path}`, { data, headers: { Cookie: cookie } });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

// ---- synthetic DICOM ------------------------------------------------------

type Element = { group: number; element: number; vr: string; value: Buffer | string | number[] };

const evenPad = (buffer: Buffer, pad: number) =>
  buffer.length % 2 ? Buffer.concat([buffer, Buffer.from([pad])]) : buffer;

function encode({ group, element, vr, value }: Element) {
  const tag = Buffer.alloc(4);
  tag.writeUInt16LE(group, 0);
  tag.writeUInt16LE(element, 2);
  let data: Buffer;
  if (vr === "US") {
    data = Buffer.alloc(2);
    data.writeUInt16LE((value as number[])[0] ?? 0);
  } else if (vr === "UL") {
    data = Buffer.alloc(4);
    data.writeUInt32LE((value as number[])[0] ?? 0);
  } else if (Buffer.isBuffer(value)) {
    data = evenPad(value, 0);
  } else {
    data = evenPad(Buffer.from(String(value), "latin1"), vr === "UI" ? 0 : 0x20);
  }
  if (vr === "OW" || vr === "OB") {
    const header = Buffer.alloc(8);
    header.write(vr, 0, "latin1");
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([tag, header, data]);
  }
  const header = Buffer.alloc(4);
  header.write(vr, 0, "latin1");
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([tag, header, data]);
}

type SyntheticImage = { rows: number; columns: number; instance: number; z: number; spacing: number };

const BACKSLASH = String.fromCharCode(92);
const multi = (...values: Array<number | string>) => values.join(BACKSLASH);

/** An uncompressed explicit-VR little-endian MR slice with a non-flat, per-instance pattern. */
export function syntheticDicom(image: SyntheticImage, seriesUid: string) {
  const { rows, columns, instance, z, spacing } = image;
  const sopInstance = `${seriesUid}.${instance}`;
  const pixels = Buffer.alloc(rows * columns * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const dx = x - columns * (0.3 + 0.04 * instance);
      const dy = y - rows / 2;
      const disc = Math.hypot(dx, dy) < rows / 5 ? 1800 : 0;
      pixels.writeUInt16LE(Math.min(4095, 300 + Math.round((x / columns) * 1200) + disc), (y * columns + x) * 2);
    }
  }
  const transferSyntax = "1.2.840.10008.1.2.1";
  const sopClass = "1.2.840.10008.5.1.4.1.1.4";
  const metaBody = Buffer.concat(
    (
      [
        { group: 2, element: 1, vr: "OB", value: Buffer.from([0, 1]) },
        { group: 2, element: 2, vr: "UI", value: sopClass },
        { group: 2, element: 3, vr: "UI", value: sopInstance },
        { group: 2, element: 16, vr: "UI", value: transferSyntax },
      ] as Element[]
    ).map(encode),
  );
  const meta = Buffer.concat([encode({ group: 2, element: 0, vr: "UL", value: [metaBody.length] }), metaBody]);
  const dataset = Buffer.concat(
    (
      [
        { group: 0x8, element: 0x16, vr: "UI", value: sopClass },
        { group: 0x8, element: 0x18, vr: "UI", value: sopInstance },
        { group: 0x8, element: 0x60, vr: "CS", value: "MR" },
        { group: 0x18, element: 0x50, vr: "DS", value: String(spacing) },
        { group: 0x20, element: 0xd, vr: "UI", value: `${seriesUid}.1` },
        { group: 0x20, element: 0xe, vr: "UI", value: seriesUid },
        { group: 0x20, element: 0x13, vr: "IS", value: String(instance) },
        { group: 0x20, element: 0x32, vr: "DS", value: multi(0, 0, z) },
        { group: 0x20, element: 0x37, vr: "DS", value: multi(1, 0, 0, 0, 1, 0) },
        { group: 0x20, element: 0x52, vr: "UI", value: `${seriesUid}.2` },
        { group: 0x28, element: 0x2, vr: "US", value: [1] },
        { group: 0x28, element: 0x4, vr: "CS", value: "MONOCHROME2" },
        { group: 0x28, element: 0x10, vr: "US", value: [rows] },
        { group: 0x28, element: 0x11, vr: "US", value: [columns] },
        { group: 0x28, element: 0x30, vr: "DS", value: multi(spacing, spacing) },
        { group: 0x28, element: 0x100, vr: "US", value: [16] },
        { group: 0x28, element: 0x101, vr: "US", value: [16] },
        { group: 0x28, element: 0x102, vr: "US", value: [15] },
        { group: 0x28, element: 0x103, vr: "US", value: [0] },
        { group: 0x28, element: 0x1050, vr: "DS", value: "1200" },
        { group: 0x28, element: 0x1051, vr: "DS", value: "2400" },
        { group: 0x28, element: 0x1052, vr: "DS", value: "0" },
        { group: 0x28, element: 0x1053, vr: "DS", value: "1" },
        { group: 0x7fe0, element: 0x10, vr: "OW", value: pixels },
      ] as Element[]
    ).map(encode),
  );
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), meta, dataset]);
}

export type SyntheticSeries = {
  seriesKey: string;
  directory: string;
  studyDate: string;
  modality: string;
  studyDescription: string;
  seriesDescription: string;
  seriesNumber: number;
  count: number;
  size?: number;
  spacing?: number;
};

export const biopsySeries: SyntheticSeries = {
  seriesKey: "1.2.826.0.1.3680043.8.498.1001",
  directory: "4-10 biopsy/LASTERDIANAD (1)/SER00003",
  studyDate: "2026-04-10",
  modality: "US",
  studyDescription: "US Axilla Core BX RT IMGUS0248",
  seriesDescription: "US Axilla Core BX RT IMGUS0248",
  seriesNumber: 2,
  count: BIOPSY_IMAGE_COUNT,
};

/** Baseline and follow-up phase-2 subtraction stacks the seeded April 1 vs June 26 comparison resolves. */
export const comparisonSeries: SyntheticSeries[] = [
  {
    seriesKey: "1.2.826.0.1.3680043.8.498.2001",
    directory: "04-01-breast-mri/dicoms/0401",
    studyDate: "2026-04-01",
    modality: "MR",
    studyDescription: "Breast MRI",
    seriesDescription: "SUB PH 2",
    seriesNumber: 100,
    count: 6,
  },
  {
    seriesKey: "1.2.826.0.1.3680043.8.498.2002",
    directory: "06-26-breast-mri/dicoms/0626",
    studyDate: "2026-06-26",
    modality: "MR",
    studyDescription: "Breast MRI",
    seriesDescription: "PHASE 2 SUB",
    seriesNumber: 101,
    count: 7,
  },
];

const fileName = (index: number) => `IMG${String(index).padStart(5, "0")}.dcm`;

function seriesImages(series: SyntheticSeries) {
  const size = series.size ?? 256;
  const spacing = series.spacing ?? 0.7;
  return Array.from({ length: series.count }, (_, index) => {
    const instance = index + 1;
    const relativePath = `${series.directory}/${fileName(instance)}`;
    return {
      id: `${series.seriesKey}-${instance}`,
      fileName: fileName(instance),
      relativePath,
      byteLength: size * size * 2 + 700,
      modifiedAt: "2026-07-01T00:00:00.000Z",
      imageId: `/api/dicom/file?path=${encodeURIComponent(relativePath)}`,
      instanceNumber: instance,
      imagePosition: instance * 1.5,
      rows: size,
      columns: size,
      pixelSpacing: [spacing, spacing] as [number, number],
    };
  });
}

function catalogSeries(series: SyntheticSeries) {
  return {
    id: series.seriesKey,
    seriesKey: series.seriesKey,
    label: `${series.studyDate} · ${series.modality} · ${series.seriesDescription} · Series ${series.seriesNumber}`,
    root: "synthetic",
    directory: series.directory,
    relativeDirectory: series.directory,
    modality: series.modality,
    studyDescription: series.studyDescription,
    seriesDescription: series.seriesDescription,
    studyDate: series.studyDate,
    seriesNumber: series.seriesNumber,
    imageCount: series.count,
    images: seriesImages(series),
  };
}

/**
 * Serves the DICOM catalog, per-series image lists and pixel files for `series`
 * from memory. Register before navigating; later `page.route` handlers (such as
 * `holdDicomFileRequest`) run first and call `route.fallback()` to reach these.
 */
export async function installSyntheticDicom(page: Page, series: SyntheticSeries[]) {
  const byPath = new Map<string, { series: SyntheticSeries; instance: number }>();
  for (const entry of series) {
    for (let instance = 1; instance <= entry.count; instance++) {
      byPath.set(`${entry.directory}/${fileName(instance)}`, { series: entry, instance });
    }
  }

  await page.route("**/api/dicom/studies**", async (route) => {
    const directories = new URL(route.request().url()).searchParams.getAll("directory");
    const matching = series.filter(
      (entry) =>
        !directories.length ||
        directories.some((directory) => entry.directory.toLowerCase().includes(directory.toLowerCase())),
    );
    await route.fulfill({
      json: { root: "synthetic", rootsTried: ["synthetic"], series: matching.map(catalogSeries) },
    });
  });
  await page.route("**/api/dicom/series?**", async (route) => {
    const key = new URL(route.request().url()).searchParams.get("key");
    const entry = series.find((candidate) => candidate.seriesKey === key);
    await route.fulfill({ json: { images: entry ? seriesImages(entry) : [] } });
  });
  await page.route("**/api/dicom/file?**", async (route) => {
    const requested = new URL(route.request().url()).searchParams.get("path") ?? "";
    const hit = byPath.get(requested);
    if (!hit) return route.fulfill({ status: 404, json: { error: "DICOM file not found" } });
    const size = hit.series.size ?? 256;
    await route.fulfill({
      status: 200,
      contentType: "application/dicom",
      body: syntheticDicom(
        { rows: size, columns: size, instance: hit.instance, z: hit.instance * 1.5, spacing: hit.series.spacing ?? 0.7 },
        hit.series.seriesKey,
      ),
    });
  });
}

export async function gotoViewer(page: Page, biopsyId = BIOPSY_ID) {
  await page.goto(`/tools/dicom-viewer?id=${biopsyId}${studySetParam}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dicom-cornerstone-viewport")).toBeVisible();
  await expect(page.getByRole("button", { name: "W/L", exact: true })).toBeVisible();
  await expect(page.locator('[data-test-id="dicom-cornerstone-viewport"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("dicom-image-loading")).toBeHidden({ timeout: 30_000 });
}

type TestBox = { height: number; width: number; x: number; y: number };

export async function expectToolState(
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

export async function installInteractionProbe(page: Page) {
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

export async function resetInteractionProbe(page: Page) {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __dicomInteractionProbe?: { cameraModified: number; voiModified: number };
    };
    win.__dicomInteractionProbe = { cameraModified: 0, voiModified: 0 };
  });
}

export async function interactionProbe(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __dicomInteractionProbe?: { cameraModified: number; voiModified: number };
    };
    return win.__dicomInteractionProbe ?? { cameraModified: 0, voiModified: 0 };
  });
}

export async function dispatchTouchDrag(
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

export function holdDicomFileRequest(page: Page, fileName: string) {
  let release = () => {};
  let released = false;
  const requestSeen = new Promise<void>((resolve) => {
    void page.route("**/api/dicom/file?**", async (route) => {
      const url = route.request().url();
      if (!url.includes(fileName) || released) {
        await route.fallback();
        return;
      }

      resolve();
      await new Promise<void>((next) => {
        release = next;
      });
      released = true;
      await route.fallback();
    });
  });

  return {
    requestSeen,
    release: () => release(),
  };
}

export async function installAnnotationApiMock(page: Page) {
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
      worldEnd?: number[];
      worldStart?: number[];
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
            worldEnd?: number[];
            worldStart?: number[];
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

export async function setRangeValue(page: Page, testId: string, value: string) {
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

export function pointInBox(box: TestBox, x: number, y: number) {
  return {
    x: box.x + box.width * x,
    y: box.y + box.height * y,
  };
}

export async function drawAnnotation(
  page: Page,
  kind: "Arrow" | "Box" | "Circle" | "Ruler" | "Text",
  box: TestBox,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.getByRole("button", { name: "Draw" }).click();
  await page.getByRole("button", { name: kind }).click();
  await expect(
    page.getByTestId(`dicom-annotation-tool-${kind.toLowerCase()}`),
  ).toHaveAttribute("aria-pressed", "true");
  const drawStart = pointInBox(box, start.x, start.y);
  const drawEnd = pointInBox(box, end.x, end.y);
  await page.mouse.move(drawStart.x, drawStart.y);
  await page.mouse.down();
  await page.mouse.move(drawEnd.x, drawEnd.y);
  await page.mouse.up();
}

export function latestSavedAnnotation(annotationApi: AnnotationApiMock) {
  const annotation = annotationApi.saves.at(-1)?.annotations[0];
  expect(annotation).toBeTruthy();
  return annotation!;
}

export function latestSavedAnnotations(annotationApi: AnnotationApiMock) {
  const annotations = annotationApi.saves.at(-1)?.annotations;
  expect(annotations).toBeTruthy();
  return annotations!;
}

export function expectNumberCloseTo(
  value: number | undefined,
  expected: number,
  tolerance = 0.008,
) {
  expect(value).toBeDefined();
  expect(Math.abs(value! - expected)).toBeLessThanOrEqual(tolerance);
}

export function requireNumber(value: number | undefined, label: string) {
  expect(value, label).toBeDefined();
  return value!;
}