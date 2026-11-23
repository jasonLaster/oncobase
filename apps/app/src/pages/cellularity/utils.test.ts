import { describe, expect, test } from "bun:test";
import {
  CELLULARITY_ASSET_BASE,
  CELLULARITY_DATA_URL,
  calcRCB,
  calcRcbNodalTerm,
  cellularityAssetUrl,
  heatColor,
  rcbClass,
} from "./utils";

describe("cellularity utils", () => {
  test("builds generic authenticated /api/file asset URLs", () => {
    expect(CELLULARITY_DATA_URL).toBe(
      `/api/file?path=${encodeURIComponent(`${CELLULARITY_ASSET_BASE}/data.json`)}`,
    );
    expect(cellularityAssetUrl("04_bed.jpg")).toBe(
      `/api/file?path=${encodeURIComponent(`${CELLULARITY_ASSET_BASE}/04_bed.jpg`)}`,
    );
  });

  test("reproduces Symmans et al. (JCO 2007) RCB index and class cutoffs", () => {
    const sampleParams = {
      d1_mm: 20,
      d2_mm: 15,
      positive_nodes: 1,
      max_met_mm: 3.0,
      pct_in_situ: 0,
    };
    const rcb = calcRCB(10, sampleParams);
    expect(rcb.prim).toBeGreaterThan(1.4);
    expect(rcb.nodal).toBeCloseTo(calcRcbNodalTerm(1, 3.0), 6);
    expect(rcb.total).toBeCloseTo(rcb.prim + rcb.nodal, 6);
    expect(rcbClass(rcb.total).label).toBe("RCB-II");

    // Zero positive nodes yields zero nodal term
    expect(calcRcbNodalTerm(0, 5)).toBe(0);
    expect(calcRCB(0, { ...sampleParams, positive_nodes: 0 }).total).toBe(0);

    expect(rcbClass(0)).toEqual({ label: "RCB-0 (pCR)", tone: "ok" });
    expect(rcbClass(1.36)).toEqual({ label: "RCB-I", tone: "ok" });
    expect(rcbClass(1.37)).toEqual({ label: "RCB-II", tone: "ok" });
    expect(rcbClass(3.28)).toEqual({ label: "RCB-II", tone: "ok" });
    expect(rcbClass(3.29)).toEqual({ label: "RCB-III", tone: "red" });
  });

  test("maps cellularity percentages to valid rgb colors", () => {
    expect(heatColor(0)).toBe("rgb(246,244,239)");
    expect(heatColor(5)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(heatColor(40)).toBe(heatColor(35));
  });
});
