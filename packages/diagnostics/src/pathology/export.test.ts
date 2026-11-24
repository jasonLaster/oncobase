import { expect, test } from "bun:test";
import { exportFileName, planExport } from "./export";

const slide = { width: 100_000, height: 60_000, tileSize: 1024, overlap: 1, maxLevel: 17 };

test("a small field exports at full resolution with overlap-aligned tiles", () => {
  const plan = planExport(slide, { x: 1000.4, y: 2000, width: 1500, height: 900 })!;
  expect(plan).toMatchObject({ level: 17, downsample: 1, width: 1501, height: 900, left: 1000, top: 2000 });
  expect(plan.tiles).toEqual([
    { col: 0, row: 1, dx: -1000, dy: -977 }, { col: 1, row: 1, dx: 23, dy: -977 }, { col: 2, row: 1, dx: 1047, dy: -977 },
    { col: 0, row: 2, dx: -1000, dy: 47 }, { col: 1, row: 2, dx: 23, dy: 47 }, { col: 2, row: 2, dx: 1047, dy: 47 },
  ]);
});

test("the whole slide drops to the sharpest level that fits the canvas budget", () => {
  const plan = planExport(slide, { x: 0, y: 0, width: slide.width, height: slide.height })!;
  expect(plan.downsample).toBe(32);
  expect([plan.width, plan.height]).toEqual([3125, 1875]);
  expect(plan.tiles).toHaveLength(4 * 2);
});

test("rectangles are clipped to the slide and empty ones are rejected", () => {
  expect(planExport(slide, { x: -50, y: -50, width: 100, height: 100 })).toMatchObject({ left: 0, top: 0, width: 50, height: 50 });
  expect(planExport(slide, { x: 200_000, y: 0, width: 10, height: 10 })).toBeNull();
});

test("file names are filesystem-safe and describe the export", () => {
  expect(exportFileName({ slideId: "he-x", label: "Block A1 / 10×", stain: "H&E" }, "view", { width: 10, height: 20 }))
    .toBe("block-a1-10_he_view_10x20.jpg");
});
