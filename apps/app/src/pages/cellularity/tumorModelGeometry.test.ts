import { describe, expect, test } from "bun:test";
import type { BlockGrid, SliceMeta } from "./types";
import {
  explodeOffset,
  faceFacing,
  FACES,
  fieldToPlaneYZ,
  fitOrthoZoom,
  inkWeights,
  nearestInkedEdge,
  niceScaleBar,
  placeLabels,
  rectsOverlap,
  slabsFromSlices,
  stepScanned,
  trayLayout,
  assayLabel,
  reportedMarginFindings,
  VIEW_PRESETS,
  meshSectionX,
  loopArea,
  pointInLoop,
  capOutlines,
} from "./tumorModelGeometry";

const slice = (id: string, x0: number, x1: number, scanned = true, in_bed = true): SliceMeta => ({
  id,
  label: id,
  slice_num: 0,
  part: "",
  in_bed,
  scanned,
  kind: scanned ? "keratin" : null,
  x0_mm: x0,
  x1_mm: x1,
  report_note: "",
  margins: [],
});

/** 10 × 10 one-mm fields; silhouette at 2× resolution (n = 2 → step 1 → 0.5 mm cells). */
function squareGrid(hot: [number, number, number][], holeAt?: [number, number]): BlockGrid {
  const silW = 20;
  const silH = 20;
  const rows: string[] = [];
  for (let r = 0; r < silH; r++) {
    let s = "";
    for (let c = 0; c < silW; c++) {
      const isHole = holeAt && Math.abs(r - holeAt[0]) <= 1 && Math.abs(c - holeAt[1]) <= 1;
      s += isHole ? "0" : "1";
    }
    rows.push(s);
  }
  return {
    cols: 10,
    rows: 10,
    w_mm: 10,
    h_mm: 10,
    plane_w_mm: 10,
    plane_h_mm: 10,
    plane_off_z: 0,
    plane_off_y: 0,
    y0: 0,
    x0: 0,
    n: 2,
    aligned: true,
    align_note: "",
    tissue: [],
    bed: [],
    fields: hot.map(([c, r, p]) => [c, r, p, 0, 0]),
    si_profile: [],
    sil_rows: rows,
    sil_h: silH,
    sil_w: silW,
  };
}

describe("slabs", () => {
  const slices = [slice("E1", -5, -1, true, false), slice("B3", 5, 10), slice("B1", 0, 5, false), slice("B4", 10, 15)];

  test("keeps in-bed slices, sorted lateral → medial, centered on the bed", () => {
    const slabs = slabsFromSlices(slices, 20);
    expect(slabs.map((s) => s.id)).toEqual(["B1", "B3", "B4"]);
    expect(slabs[0].x0).toBe(-10);
    expect(slabs[2].x1).toBe(5);
    expect(slabs[1].xc).toBe(-2.5);
  });

  test("explode offsets are symmetric and scale with explode", () => {
    expect(explodeOffset(0, 3, 1, 7)).toBe(-7);
    expect(explodeOffset(1, 3, 1, 7)).toBe(0);
    expect(explodeOffset(2, 3, 0.5, 7)).toBe(3.5);
    expect(explodeOffset(2, 3, 0, 7)).toBe(0);
  });

  test("stepping skips unscanned slabs and wraps", () => {
    const slabs = slabsFromSlices(slices, 20);
    expect(stepScanned(slabs, "B3", 1)).toBe("B4");
    expect(stepScanned(slabs, "B4", 1)).toBe("B3");
    expect(stepScanned(slabs, "B3", -1)).toBe("B4");
    expect(stepScanned(slabs, "B1", 1)).toBe("B3");
  });
});

describe("slice plane mapping", () => {
  test("col 0 is superior (−Z), row 0 is anterior (+Y)", () => {
    const g = squareGrid([]);
    const [yTopLeft, zTopLeft] = fieldToPlaneYZ(g, 0, 0);
    const [yBottomRight, zBottomRight] = fieldToPlaneYZ(g, 9, 9);
    expect(zTopLeft).toBeCloseTo(-4.5);
    expect(yTopLeft).toBeCloseTo(4.5);
    expect(zBottomRight).toBeCloseTo(4.5);
    expect(yBottomRight).toBeCloseTo(-4.5);
  });
});

describe("nearest inked edge", () => {
  test("returns null without hot fields", () => {
    expect(nearestInkedEdge(squareGrid([[5, 5, 2]]), 5)).toBeNull();
  });

  test("measures to the superior edge for a field near column 0", () => {
    const r = nearestInkedEdge(squareGrid([[1, 5, 30]]), 5);
    expect(r?.direction).toBe("superior");
    // Field center at 1.5 mm; the tissue ends at 0 mm.
    expect(r?.mm).toBeCloseTo(1.5, 2);
    expect(r?.nHot).toBe(1);
  });

  test("picks the closest of several hot fields and reports anterior for row 0 side", () => {
    const r = nearestInkedEdge(squareGrid([[5, 5, 10], [5, 0, 8]]), 5);
    expect(r?.direction).toBe("anterior");
    expect(r?.mm).toBeCloseTo(0.5, 2);
  });

  test("internal holes are not the inked edge", () => {
    // A hole right next to the hot field must be ignored: the true edge is ≥ 4 mm away.
    const r = nearestInkedEdge(squareGrid([[5, 5, 20]], [10, 13]), 5);
    expect(r?.mm).toBeGreaterThan(4);
  });
});

describe("scale bar and fit", () => {
  test("niceScaleBar picks the largest 1-2-5 length under maxPx", () => {
    expect(niceScaleBar(10, 120)).toEqual({ mm: 10, px: 100 });
    expect(niceScaleBar(3, 120).mm).toBe(20);
    expect(niceScaleBar(100, 120).mm).toBe(1);
  });

  test("fitOrthoZoom is limited by the tighter axis", () => {
    expect(fitOrthoZoom(2, 25, 40, 10, 1)).toBeCloseTo(2.5);
    expect(fitOrthoZoom(0.5, 25, 40, 10, 1)).toBeCloseTo(0.625);
  });
});

describe("faces and inks", () => {
  test("six faces, opposite pairs", () => {
    expect(FACES).toHaveLength(6);
    for (let i = 0; i < 6; i += 2) {
      const a = FACES[i].normal;
      const b = FACES[i + 1].normal;
      expect(a[0] + b[0] + a[1] + b[1] + a[2] + b[2]).toBe(0);
    }
  });

  test("ink weights sum to 1 and pick the face the normal points at", () => {
    const w = inkWeights([0, 0, -1]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(FACES[w.indexOf(Math.max(...w))].key).toBe("superior");
  });

  test("facing is positive toward the camera", () => {
    expect(faceFacing([0, 1, 0], [0, 10, 0])).toBeCloseTo(1);
    expect(faceFacing([0, -1, 0], [0, 10, 0])).toBeCloseTo(-1);
  });

  test("every preset camera keeps lateral on the left of the screen", () => {
    // Screen-right = forward × up with forward = −dir, up = +Y → (dir.z, 0, −dir.x); medial (+X) must point right.
    for (const p of VIEW_PRESETS) expect(-p.dir[0]).toBeGreaterThan(0);
  });
});

describe("label placement", () => {
  test("never returns overlapping visible labels and keeps them in bounds", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `l${i}`,
      x: 100 + (i % 3) * 4,
      y: 50 + (i % 2) * 3,
      w: 60,
      h: 18,
      priority: 12 - i,
      movable: i % 2 === 0,
    }));
    const out = placeLabels(items, { w: 300, h: 200 });
    const vis = out.filter((p) => p.visible);
    expect(vis[0]?.id).toBe("l0");
    for (let i = 0; i < vis.length; i++) {
      const a = items.find((it) => it.id === vis[i].id)!;
      const ra = { l: vis[i].x - a.w / 2, t: vis[i].y - a.h / 2, r: vis[i].x + a.w / 2, b: vis[i].y + a.h / 2 };
      expect(ra.l).toBeGreaterThanOrEqual(0);
      expect(ra.r).toBeLessThanOrEqual(300);
      for (let j = i + 1; j < vis.length; j++) {
        const b = items.find((it) => it.id === vis[j].id)!;
        const rb = { l: vis[j].x - b.w / 2, t: vis[j].y - b.h / 2, r: vis[j].x + b.w / 2, b: vis[j].y + b.h / 2 };
        expect(rectsOverlap(ra, rb)).toBe(false);
      }
    }
  });

  test("fixed labels outside the reserved top band are hidden, not moved", () => {
    const out = placeLabels([{ id: "a", x: 50, y: 5, w: 20, h: 10, priority: 1 }], { w: 100, h: 100, top: 20 });
    expect(out[0].visible).toBe(false);
  });
});

describe("tray layout", () => {
  test("a wide viewport lays slabs out in reading order, lateral first", () => {
    const t = trayLayout(8, 2.4);
    expect(t.cols * t.rows).toBeGreaterThanOrEqual(8);
    // Row-major: x increases within a row, rows go downward.
    expect(t.pos[1][0]).toBeGreaterThan(t.pos[0][0]);
    expect(t.pos[t.cols]?.[1] ?? -Infinity).toBeLessThan(t.pos[0][1]);
  });

  test("a narrow viewport uses fewer columns than a wide one", () => {
    expect(trayLayout(8, 0.8).cols).toBeLessThan(trayLayout(8, 2.4).cols);
  });

  test("the layout is centered", () => {
    const t = trayLayout(4, 10);
    expect(t.rows).toBe(1);
    expect(t.pos.reduce((a, p) => a + p[0], 0)).toBeCloseTo(0);
  });
});

describe("provenance and reported findings", () => {
  test("names the stain behind each block", () => {
    expect(assayLabel("keratin, measured")).toBe("lab PanKeratin stain");
    expect(assayLabel("virtual PanCK (Strand)")).toBe("AI virtual PanCK from H&E");
    expect(assayLabel(undefined)).toBe("not scanned");
  });

  test("keeps margin findings and drops extent, cavity and focus notes", () => {
    const mk = (id: string, margins: string[]) => ({ ...slice(id, 0, 1), margins });
    const out = reportedMarginFindings([
      mk("B3", ["Invasive at inferior margin", "Biopsy clip + Magseed cavity"]),
      mk("B6", ["20 mm S–I extent · 1 mm superior", "Peninsula ~20% focus"]),
      mk("B5", ["DCIS <1 mm inferior"]),
      mk("B4", []),
    ]);
    expect(out).toEqual([
      { id: "B3", label: "B3", findings: ["Invasive at inferior margin"] },
      { id: "B6", label: "B6", findings: ["1 mm from superior margin"] },
      { id: "B5", label: "B5", findings: ["DCIS <1 mm inferior"] },
    ]);
  });
});

describe("end-slab caps", () => {
  // Unit cube [-1,1]^3 as 12 triangles.
  const v = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const f = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];

  test("a plane through a closed box gives one closed 2×2 square", () => {
    const loops = meshSectionX(v, f, 0.25);
    expect(loops.length).toBe(1);
    expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(4, 5);
  });

  test("a plane outside the mesh gives nothing", () => {
    expect(meshSectionX(v, f, 3)).toEqual([]);
  });

  test("a plane through a vertex layer still closes", () => {
    const loops = meshSectionX(v, f, 1);
    expect(loops.length).toBeLessThanOrEqual(1);
  });

  test("nested loops become an outline with a hole", () => {
    const outer: [number, number][] = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    const hole: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const caps = capOutlines([outer, hole]);
    expect(caps.length).toBe(1);
    expect(caps[0].holes.length).toBe(1);
    expect(pointInLoop([0, 0], outer)).toBe(true);
    expect(pointInLoop([9, 0], outer)).toBe(false);
  });
});
