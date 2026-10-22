import { expect, test, type Page } from "@playwright/test";
import type { PathologyRegion, PathologySlide } from "@oncobase/diagnostics/pathology/model";

const slides: PathologySlide[] = ["a", "b"].map((letter, index) => ({
  slideId: `he-${letter.repeat(20)}`, label: `Synthetic slide ${index + 1}`, accession: `FIXTURE-${index + 1}`, stain: "H&E",
  sourceFileName: `synthetic-${index + 1}.svs`, sourceUri: `s3://fixture/slide-${index + 1}.svs`, sourceBytes: 100,
  sourceSha256: letter.repeat(64), width: 20000, height: 10000, tileSize: 1024, overlap: 1, maxLevel: 15, tileCount: 400,
  mppX: .25, mppY: .25, objectivePower: 40, scanner: "Synthetic scanner", scanDate: "07/09/2026", colorProfile: "sRGB",
}));

async function fixture(page: Page, collection = slides) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1026; canvas.height = 1026;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fffaf7"; ctx.fillRect(0, 0, 1026, 1026);
    for (let i = 0; i < 28; i++) {
      const x = 60 + (i * 149) % 880, y = 70 + (i * 227) % 880;
      ctx.fillStyle = "#df94b1"; ctx.beginPath(); ctx.ellipse(x, y, 72, 34, i, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#865b9e"; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    }
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const image = Buffer.from(png, "base64");
  const notes = new Map<string, { regions: PathologyRegion[]; version: number }>();
  const behavior = { conflict: false, saveFailure: false, tilesFailure: false, saveBarrier: null as Promise<void> | null };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/pathology/slides") return route.fulfill({ json: { slides: collection } });
    const slideId = url.pathname.split("/")[4];
    if (url.pathname.endsWith("/regions")) {
      const current = notes.get(slideId) ?? { regions: [], version: 0 };
      if (request.method() === "GET") return route.fulfill({ json: current });
      if (behavior.saveBarrier) await behavior.saveBarrier;
      if (behavior.saveFailure) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      if (behavior.conflict) return route.fulfill({ status: 409, json: { conflict: true, version: current.version + 1 } });
      const body = request.postDataJSON();
      expect(body.sourceSha256).toBe(collection.find(s => s.slideId === slideId)?.sourceSha256);
      expect(body.expectedVersion).toBe(current.version);
      notes.set(slideId, { regions: body.regions, version: current.version + 1 });
      return route.fulfill({ json: { conflict: false, version: current.version + 1 } });
    }
    if (url.pathname.includes("/tiles/") || url.pathname.endsWith("/thumbnail")) {
      if (behavior.tilesFailure) return route.fulfill({ status: 503, json: { error: "Tile unavailable" } });
      return route.fulfill({ status: 200, contentType: "image/png", body: image });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected API dependency" } });
  });
  return { notes, behavior };
}

async function open(page: Page) {
  await page.goto(`/tools/pathology-viewer?slide=${slides[0].slideId}`);
  await expect(page.getByTestId("pathology-canvas").first()).toHaveAttribute("data-render-status", "ready");
}

async function draw(page: Page, label = "Draw region") {
  await page.getByRole("button", { name: label, exact: true }).click();
  const box = await page.getByTestId("pathology-canvas").first().boundingBox();
  if (!box) throw new Error("Missing canvas");
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel("Region label", { exact: true })).toBeVisible();
}

// Pathology viewer journeys. Slides, tiles and notes are served by route mocks
// (no wiki database, no real slides), so this needs only the app, not the local stack.

test("opens independently of the wiki database, supports calibrated magnification and rotation, and keeps measurements calibrated through rotate and pan", async ({ page }) => {
  const state = await fixture(page); await open(page);
  const failures: string[] = []; page.on("pageerror", e => failures.push(e.message));
  await expect(page.getByRole("heading", { name: "Pathology slides" })).toBeVisible();
  await expect(page.getByTestId("pathology-slide-card")).toHaveCount(2);
  await page.getByRole("button", { name: "20× magnification", exact: true }).click();
  await expect(page.getByTestId("pathology-magnification")).toHaveText("20.0×");
  await expect(page.getByTestId("pathology-scalebar")).toBeVisible();
  await page.getByRole("button", { name: "Rotate 90 degrees", exact: true }).click();
  await page.getByRole("button", { name: "Copy current view link" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("rotation")).toBe("90.000000");
  await page.getByRole("button", { name: "Fit tissue", exact: true }).click();
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(r => r.name));
  expect(resources.some(name => /livestore\/schema|@livestore_livestore/.test(name))).toBe(false);

  await draw(page, "Measure");
  await expect(page.locator(".pathology-region-list small")).toContainText(/µm|mm/);
  await page.getByTestId("pathology-save-notes").click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  const before = state.notes.get(slides[0].slideId)?.regions[0];
  await page.getByRole("button", { name: "Rotate 90 degrees", exact: true }).click();
  await page.getByTestId("pathology-canvas").focus(); await page.keyboard.press("ArrowRight");
  expect(state.notes.get(slides[0].slideId)?.regions[0]).toEqual(before);
  expect(before?.kind).toBe("ruler");
  expect(failures).toEqual([]);
});

const octoberStains = [...Array(9).fill("H&E"), ...Array(5).fill("PanKera"), "ER", "PR", "HER2", "MIB1", "p63"] as string[];
const dateCatalog = [...octoberStains, "H&E", "H&E"].map((stain, i) => ({
  ...slides[0], stain, slideId: `he-${(i + 1).toString(16).padStart(20, "0")}`,
  label: `Synthetic ${stain} ${String(i + 1).padStart(2, "0")}`, sourceSha256: (i + 1).toString(16).padStart(64, "0"),
  scanDate: i < 19 ? "10/13/2026" : "07/09/2026",
}));

test("October stain tabs browse all nineteen slides while July stays separate", async ({ page }) => {
  await fixture(page, dateCatalog);
  for (const width of [1440, 393]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/pathology-viewer?collection=2026-10-13");
    await expect(page.getByRole("tab")).toHaveCount(7);
    await expect(page.getByRole("tab", { name: "H&E (9)", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Select slide", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("pathology-slide-card")).toHaveCount(9);
    const tabsBefore = await page.getByRole("tablist", { name: "Stains" }).boundingBox();
    await page.getByTestId("pathology-slide-card").last().click();
    await expect(page.getByRole("button", { name: "Next slide", exact: true })).toBeDisabled();
    const tabsAfter = await page.getByRole("tablist", { name: "Stains" }).boundingBox();
    expect(Math.abs(tabsAfter!.y - tabsBefore!.y)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Previous slide", exact: true }).click();
    await expect(page.getByTestId("pathology-canvas").first()).toHaveAttribute("data-slide-id", dateCatalog[7].slideId);
    await page.getByRole("tab", { name: "PanKera (5)", exact: true }).click();
    await expect(page.getByTestId("pathology-slide-card")).toHaveCount(5);
    await page.getByRole("tab", { name: "H&E (9)", exact: true }).click();
    await expect(page.getByTestId("pathology-canvas").first()).toHaveAttribute("data-slide-id", dateCatalog[7].slideId);
    await page.getByRole("tab", { name: "HER2 (1)", exact: true }).click();
    await expect(page.getByTestId("pathology-slide-card")).toHaveCount(1);
    await expect(page.getByTestId("pathology-canvas").first()).toHaveAttribute("data-render-status", "ready");
    await page.getByLabel("Compare with slide", { exact: true }).selectOption(dateCatalog[7].slideId);
    await expect(page.getByTestId("pathology-canvas")).toHaveCount(2);
    await page.getByRole("button", { name: "Copy current view link" }).click();
    expect(new URL(page.url()).searchParams.get("collection")).toBe("2026-10-13");
    await page.reload();
    await expect(page.getByRole("tab", { name: "HER2 (1)", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pathology-canvas")).toHaveCount(2);
    await page.getByRole("tab", { name: "HER2 (1)", exact: true }).press("Home");
    await expect(page.getByRole("tab", { name: "H&E (9)", exact: true })).toBeFocused();
    await page.getByRole("tab", { name: "H&E (9)", exact: true }).press("ArrowRight");
    await expect(page.getByRole("tab", { name: "PanKera (5)", exact: true })).toHaveAttribute("aria-selected", "true");
    if (width === 393) for (const tab of await page.getByRole("tab").all()) {
      const box = await tab.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto("/tools/pathology-viewer?collection=2026-07-09");
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByTestId("pathology-slide-card")).toHaveCount(2);
    await expect(page.getByLabel("Compare with slide", { exact: true }).locator("option")).toHaveCount(2);
  }
  await page.goto(`/tools/pathology-viewer?collection=2026-07-09&slide=${dateCatalog[0].slideId}`);
  await expect(page.getByText("This slide is unavailable", { exact: true })).toBeVisible();
});

test("old stain links select the correct tab within the full date collection", async ({ page }) => {
  await fixture(page, dateCatalog);
  for (const stain of new Set(octoberStains)) {
    await page.goto(`/tools/pathology-viewer?${new URLSearchParams({ stain, collection: `${stain}:2026-10-13` })}`);
    const count = octoberStains.filter(s => s === stain).length;
    await expect(page.getByRole("tab")).toHaveCount(7);
    await expect(page.getByRole("tab", { name: `${stain} (${count})`, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pathology-slide-card")).toHaveCount(count);
    await expect(page.getByTestId("pathology-canvas").first()).toHaveAttribute("data-render-status", "ready");
  }
});

test("regions and notes save, reload, and stay tied to their own slide, and a failed save keeps the reviewer's draft", async ({ page }) => {
  const { notes, behavior } = await fixture(page); await open(page); await draw(page);
  await page.getByLabel("Region label", { exact: true }).fill("Review area");
  await page.getByLabel("Region note", { exact: true }).fill("Synthetic review note");
  await page.getByTestId("pathology-save-notes").click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  expect(notes.get(slides[0].slideId)?.regions[0].note).toBe("Synthetic review note");
  await page.reload();
  await expect(page.getByRole("button", { name: /Review area Synthetic review note/ })).toBeVisible();
  await page.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(page.getByText("Mark a region or take a measurement, then add a note.")).toBeVisible();
  await page.getByRole("button", { name: "Previous slide", exact: true }).click();
  await expect(page.getByRole("button", { name: /Review area Synthetic review note/ })).toBeVisible();

  await draw(page);
  await page.getByLabel("Region note", { exact: true }).fill("Keep this draft");
  behavior.saveFailure = true;
  await page.getByTestId("pathology-save-notes").click();
  await expect(page.getByText("Save failed. Your edits are still here; retry Save.")).toBeVisible();
  await expect(page.getByLabel("Region note", { exact: true })).toHaveValue("Keep this draft");
  behavior.saveFailure = false; behavior.conflict = true;
  await page.getByTestId("pathology-save-notes").click();
  await expect(page.getByText(/Another reviewer changed these notes/)).toBeVisible();
  await expect(page.getByLabel("Region note", { exact: true })).toHaveValue("Keep this draft");
});

test("missing shared sources and failed tiles show explicit errors", async ({ page }) => {
  const { behavior } = await fixture(page);
  await page.goto("/tools/pathology-viewer?slide=he-cccccccccccccccccccc");
  await expect(page.getByRole("heading", { name: "This slide is unavailable" })).toBeVisible();
  await expect(page.getByTestId("pathology-canvas")).toHaveCount(0);
  // Expected decode errors include OSD's entire tile graph in Vite's console relay.
  await page.evaluate(() => {
    const original = console.error;
    console.error = (...args: unknown[]) => { if (!String(args[0]).startsWith("Tile ")) original(...args); };
  });
  behavior.tilesFailure = true;
  await page.getByRole("button", { name: "Open slide collection" }).click();
  await expect(page.getByTestId("pathology-canvas")).toHaveAttribute("data-render-status", "error");
  await expect(page.getByRole("alert")).toContainText("Some slide tiles could not load.");
});
