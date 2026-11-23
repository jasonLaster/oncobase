import { beforeEach, expect, test } from "bun:test";
import type { CellularityData } from "./types";
import { describeViewState, getCellularityViewState, publishCellularityViewState, resetCellularityViewState } from "./view-state";

const data = {
  slices: [{ id: "B6", label: "B6", scanned: true, kind: "keratin", stats: { whole_area: 3.2, max1: 21, n_ge5: 12 } }],
  summary: { rows: [] },
  b6_cum: { total: 3, area: [20, 10, 5] },
  report: {
    focus_explorer: { block_id: "B6", verdicts: [{ max_k: 1, text: "One hot field." }, { max_k: 3, text: "Diluted." }] },
    reconcile: { rcb: { d1_mm: 30, d2_mm: 20, positive_nodes: 2, max_met_mm: 2.8, default_ca: 5 } },
  },
} as unknown as CellularityData;

beforeEach(resetCellularityViewState);

test("describes the selected block and focus slider in words", () => {
  publishCellularityViewState({ view: "webgl", selectedBlock: "B6", focusFields: 2 });
  const text = describeViewState(getCellularityViewState(), data);
  expect(text).toContain("3D tumor model");
  expect(text).toContain("Selected block: B6 (whole-area cellularity 3.20%");
  expect(text).toContain("hottest 2 of 3 fields in B6 gives about 10.0%");
  expect(text).toContain("Diluted.");
});

test("is empty with nothing selected and ignores unchanged publishes", () => {
  expect(describeViewState({}, data)).toBe("");
  publishCellularityViewState({ selectedBlock: "B6" });
  const before = getCellularityViewState();
  publishCellularityViewState({ selectedBlock: "B6" });
  expect(getCellularityViewState()).toBe(before);
});

test("the 3D model line only shows while the 3D view is active", () => {
  const model = { camera: "isometric", hidden: ["halo"], spotlight: false, slidesOnly: false, spinning: false };
  expect(describeViewState({ view: "grid", model }, data)).not.toContain("3D model");
  expect(describeViewState({ view: "webgl", model }, data)).toContain("hidden layers: halo");
});
