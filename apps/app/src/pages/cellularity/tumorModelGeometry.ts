/**
 * Pure geometry for the 3D specimen model. No three.js or DOM here, so every
 * number the scene draws can be unit-tested.
 *
 * World frame (mm, centered on the bed):
 *   X = lateral (−) → medial (+)
 *   Y = posterior (−) → anterior (+)
 *   Z = superior (−) → inferior (+)
 */
import type { BlockGrid, SliceMeta } from "./types";

export type Vec3 = [number, number, number];

export type Slab = {
  id: string;
  label: string;
  index: number;
  /** World X of the slab faces and center. */
  x0: number;
  x1: number;
  xc: number;
  scanned: boolean;
  kind: SliceMeta["kind"];
};

/** In-bed breadloaf slabs, lateral → medial, in world X. */
export function slabsFromSlices(slices: SliceMeta[], bedLengthMm: number): Slab[] {
  const half = bedLengthMm / 2;
  return slices
    .filter((s) => s.in_bed)
    .slice()
    .sort((a, b) => a.x0_mm - b.x0_mm)
    .map((s, index) => ({
      id: s.id,
      label: s.label,
      index,
      x0: s.x0_mm - half,
      x1: s.x1_mm - half,
      xc: (s.x0_mm + s.x1_mm) / 2 - half,
      scanned: s.scanned,
      kind: s.kind,
    }));
}

/** Gap (mm) inserted between neighbouring slabs at explode = 1. */
export const EXPLODE_GAP_MM = 7;

/** X offset of a slab when the loaf is pulled apart; symmetric about the middle slab. */
export function explodeOffset(index: number, count: number, explode: number, gapMm = EXPLODE_GAP_MM): number {
  return (index - (count - 1) / 2) * explode * gapMm;
}

/** Center of a 1 mm field on a slice plane, as world [y, z] (before the slab's X). */
export function fieldToPlaneYZ(g: BlockGrid, col: number, row: number): [number, number] {
  const fw = g.plane_w_mm / g.cols;
  const fh = g.plane_h_mm / g.rows;
  const z = -g.plane_w_mm / 2 + (col + 0.5) * fw + g.plane_off_z;
  const y = g.plane_h_mm / 2 - (row + 0.5) * fh + g.plane_off_y;
  return [y, z];
}

export type Direction = "anterior" | "posterior" | "superior" | "inferior";

export type EdgeDistance = {
  /** Field center to the nearest outside silhouette cell, in mm (resolution ≈ 0.5 mm). */
  mm: number;
  direction: Direction;
  /** World [y, z] of the hot field center and of the nearest outside point. */
  from: [number, number];
  to: [number, number];
  /** Number of fields at or above the threshold. */
  nHot: number;
};

/**
 * Nearest specimen edge (inked surface) to any field ≥ minPct on one slice,
 * measured on the slice's 0.5 mm silhouette. Only outside cells connected to
 * the border count, so fat holes inside the tissue are not mistaken for ink.
 */
export function nearestInkedEdge(g: BlockGrid, minPct: number): EdgeDistance | null {
  const hot = g.fields.filter((f) => f[2] >= minPct);
  if (!hot.length || !g.sil_rows.length) return null;
  const H = g.sil_h;
  const W = g.sil_w;
  // Silhouette cell size in field units (build_web.py: step = n // 2 grid cells, field = n cells).
  const step = Math.max(1, Math.floor(g.n / 2)) / g.n;

  // Flood-fill "outside" from a 1-cell padded border.
  const PH = H + 2;
  const PW = W + 2;
  const inside = (r: number, c: number) => r >= 1 && r <= H && c >= 1 && c <= W && g.sil_rows[r - 1]?.[c - 1] === "1";
  const outside = new Uint8Array(PH * PW);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const k = stack.pop() as number;
    const r = Math.floor(k / PW);
    const c = k % PW;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= PH || nc >= PW) continue;
      const nk = nr * PW + nc;
      if (outside[nk] || inside(nr, nc)) continue;
      outside[nk] = 1;
      stack.push(nk);
    }
  }

  let best: { d2: number; fc: number; fr: number; oc: number; or: number } | null = null;
  for (const [col, row] of hot) {
    const fc = col + 0.5;
    const fr = row + 0.5;
    for (let r = 0; r < PH; r++) {
      for (let c = 0; c < PW; c++) {
        if (!outside[r * PW + c]) continue;
        // Padded cell (r, c) ↔ silhouette cell (r-1, c-1); its center in field units:
        // Closest point of that outside cell to the field center.
        const oc = Math.min(Math.max(fc, (c - 1) * step), c * step);
        const or = Math.min(Math.max(fr, (r - 1) * step), r * step);
        const d2 = (oc - fc) ** 2 + (or - fr) ** 2;
        if (!best || d2 < best.d2) best = { d2, fc, fr, oc, or };
      }
    }
  }
  if (!best) return null;
  const fieldMm = g.plane_w_mm / g.cols;
  const dCol = best.oc - best.fc;
  const dRow = best.or - best.fr;
  const direction: Direction =
    Math.abs(dCol) >= Math.abs(dRow) ? (dCol < 0 ? "superior" : "inferior") : dRow < 0 ? "anterior" : "posterior";
  const toYZ = (c: number, r: number): [number, number] => [
    g.plane_h_mm / 2 - r * (g.plane_h_mm / g.rows) + g.plane_off_y,
    -g.plane_w_mm / 2 + c * fieldMm + g.plane_off_z,
  ];
  return {
    mm: Math.sqrt(best.d2) * fieldMm,
    direction,
    from: toYZ(best.fc, best.fr),
    to: toYZ(best.oc, best.or),
    nHot: hot.length,
  };
}

/** Largest "nice" length (1-2-5 × 10^k mm) whose bar is no longer than maxPx. */
export function niceScaleBar(pxPerMm: number, maxPx = 120): { mm: number; px: number } {
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  let mm = candidates[0];
  for (const c of candidates) if (c * pxPerMm <= maxPx) mm = c;
  return { mm, px: mm * pxPerMm };
}

/** Orthographic zoom that fits a sceneW × sceneH (mm) box with padding into the view. */
export function fitOrthoZoom(aspect: number, viewHalfHeightMm: number, sceneW: number, sceneH: number, pad = 1.12): number {
  const zx = (2 * viewHalfHeightMm * aspect) / (sceneW * pad);
  const zy = (2 * viewHalfHeightMm) / (sceneH * pad);
  return Math.min(zx, zy);
}

export type Face = { key: "anterior" | "posterior" | "superior" | "inferior" | "lateral" | "medial"; normal: Vec3; ink: string; inkName: string; short: string };

/** Part B ink convention (orientation note in data.report.specimen). */
export const FACES: Face[] = [
  { key: "anterior", normal: [0, 1, 0], ink: "#c0267a", inkName: "magenta", short: "A" },
  { key: "posterior", normal: [0, -1, 0], ink: "#27272a", inkName: "black", short: "P" },
  { key: "superior", normal: [0, 0, -1], ink: "#2563eb", inkName: "blue", short: "S" },
  { key: "inferior", normal: [0, 0, 1], ink: "#15803d", inkName: "green", short: "I" },
  { key: "lateral", normal: [-1, 0, 0], ink: "#d9481f", inkName: "orange", short: "L" },
  { key: "medial", normal: [1, 0, 0], ink: "#ca8a04", inkName: "yellow", short: "M" },
];

/** How directly a face looks at the camera (1 = head-on, ≤ 0 = facing away). */
export function faceFacing(normal: Vec3, cameraDir: Vec3): number {
  const len = Math.hypot(...cameraDir) || 1;
  return (normal[0] * cameraDir[0] + normal[1] * cameraDir[1] + normal[2] * cameraDir[2]) / len;
}

/** Blend weights of the six inks for a surface normal (sharpened so faces read as solid colors). */
export function inkWeights(n: Vec3, sharpness = 4): number[] {
  const w = FACES.map((f) => Math.max(0, f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2]) ** sharpness);
  const s = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((v) => v / s);
}

// ---------------------------------------------------------------- label layout

export type LabelRequest = {
  id: string;
  /** Desired center in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
  /** Whether the label may move off its anchor to avoid a collision ("y" = only up/down). */
  movable?: boolean | "y";
};

export type LabelPlacement = { id: string; x: number; y: number; visible: boolean };

type Rect = { l: number; t: number; r: number; b: number };

const rectOf = (x: number, y: number, w: number, h: number): Rect => ({ l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 });

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap;
}

/**
 * Greedy collision avoidance: highest priority first; each label tries its
 * anchor, then (if movable) nearby offsets; labels that cannot fit inside
 * `bounds` without overlapping are hidden.
 */
export function placeLabels(
  items: LabelRequest[],
  bounds: { w: number; h: number; top?: number; bottom?: number },
  gap = 3,
): LabelPlacement[] {
  const placed: Rect[] = [];
  const out = new Map<string, LabelPlacement>();
  const top = bounds.top ?? 0;
  const bottom = bounds.bottom ?? 0;
  const sorted = items.slice().sort((a, b) => b.priority - a.priority);
  for (const it of sorted) {
    const dy = it.h + gap;
    const dx = it.w / 2 + gap;
    const offsets: [number, number][] =
      it.movable === "y"
        ? [[0, 0], [0, dy], [0, -dy], [0, 2 * dy]]
        : it.movable
          ? [[0, 0], [0, -dy], [0, dy], [dx, 0], [-dx, 0], [0, -2 * dy], [0, 2 * dy], [dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy]]
          : [[0, 0]];
    let done = false;
    for (const [ox, oy] of offsets) {
      // Clamp movable labels into the viewport; fixed ones must already be inside.
      let x = it.x + ox;
      let y = it.y + oy;
      if (it.movable === true) {
        x = Math.min(Math.max(x, it.w / 2 + 2), bounds.w - it.w / 2 - 2);
        y = Math.min(Math.max(y, top + it.h / 2 + 2), bounds.h - bottom - it.h / 2 - 2);
      }
      const r = rectOf(x, y, it.w, it.h);
      const inBounds = r.l >= 0 && r.r <= bounds.w && r.t >= top && r.b <= bounds.h - bottom;
      if (!inBounds) continue;
      if (placed.some((p) => rectsOverlap(p, r, gap))) continue;
      placed.push(r);
      out.set(it.id, { id: it.id, x, y, visible: true });
      done = true;
      break;
    }
    if (!done) out.set(it.id, { id: it.id, x: it.x, y: it.y, visible: false });
  }
  return items.map((it) => out.get(it.id) as LabelPlacement);
}

// ---------------------------------------------------------------- guided views

export type ViewId = "overview" | "slices" | "focus" | "margins";

export type ViewPreset = {
  id: ViewId;
  label: string;
  question: string;
  /** Direction from target toward the camera. */
  dir: Vec3;
  explode: number;
  /** 0 = intact loaf, 1 = slabs laid out face-on in a tray (like a gross photo of serial slices). */
  deal: number;
  /** Ghost the slabs lateral to the selected slice so its face is exposed (loaf only). */
  cut: boolean;
  /** Fade every slab but the selected one, and keep the camera on it (tray only). */
  isolate: boolean;
  /** Zoom multiplier over the fit-to-scene zoom. */
  zoom: number;
  /** Look at the dense focus instead of the bed center. */
  aimAtFocus: boolean;
  layers: { shells: boolean; halo: boolean; inks: boolean; shaves: boolean; ruler: boolean; cavity: boolean };
};

export const VIEW_PRESETS: ViewPreset[] = [
  {
    id: "overview",
    label: "Overview",
    question: "Where is the residual tumor?",
    dir: [-0.5, 0.6, 1],
    explode: 0,
    deal: 0,
    cut: false,
    isolate: false,
    zoom: 1,
    aimAtFocus: false,
    layers: { shells: true, halo: false, inks: false, shaves: false, ruler: false, cavity: true },
  },
  {
    id: "slices",
    label: "Slice by slice",
    question: "What did each slide measure?",
    dir: [-0.12, 0.42, 1],
    explode: 0,
    deal: 1,
    cut: false,
    isolate: false,
    zoom: 1,
    aimAtFocus: false,
    layers: { shells: false, halo: false, inks: false, shaves: false, ruler: false, cavity: false },
  },
  {
    id: "focus",
    label: "Dense focus",
    question: "How close is the densest tumor to the edge?",
    dir: [-0.22, 0.3, 1],
    explode: 0,
    deal: 1,
    cut: false,
    isolate: true,
    zoom: 1,
    aimAtFocus: true,
    layers: { shells: false, halo: false, inks: true, shaves: false, ruler: true, cavity: false },
  },
  {
    id: "margins",
    label: "Margins & inks",
    question: "Which surface is which, and what were the extra shaves?",
    dir: [-0.62, 0.62, 0.95],
    explode: 0,
    deal: 0,
    cut: false,
    isolate: false,
    zoom: 0.82,
    aimAtFocus: false,
    layers: { shells: true, halo: false, inks: true, shaves: true, ruler: false, cavity: false },
  },
];

/** Scene extent (mm) along screen-ish axes, used to fit the camera: loaf length grows with explode. */
export function sceneExtentMm(bedLengthMm: number, slabCount: number, explode: number, shaves: boolean): { w: number; h: number } {
  const w = bedLengthMm + (slabCount - 1) * explode * EXPLODE_GAP_MM + (shaves ? 18 : 0);
  return { w, h: 30 + (shaves ? 8 : 0) };
}

/** Selected index after stepping through scanned slabs (wraps). */
export function stepScanned(slabs: Slab[], currentId: string, delta: number): string {
  const scanned = slabs.filter((s) => s.scanned);
  if (!scanned.length) return currentId;
  const i = scanned.findIndex((s) => s.id === currentId);
  if (i === -1) return scanned[0].id;
  return scanned[(i + delta + scanned.length) % scanned.length].id;
}

/** Tray cell (mm) for one dealt-out slab: widest slice face plus a gutter. */
export const TRAY_CELL: { w: number; h: number } = { w: 31, h: 27 };

/**
 * Grid for laying n slabs out face-on: the column count that gives the
 * largest zoom for the viewport aspect, filled row by row lateral → medial.
 */
export function trayLayout(n: number, aspect: number, cell = TRAY_CELL): { cols: number; rows: number; pos: [number, number][] } {
  let best = { cols: n, rows: 1, score: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const score = Math.min(aspect / (cols * cell.w), 1 / (rows * cell.h));
    if (score > best.score + 1e-9) best = { cols, rows, score };
  }
  const { cols, rows } = best;
  const pos: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    pos.push([(c - (cols - 1) / 2) * cell.w, ((rows - 1) / 2 - r) * cell.h]);
  }
  return { cols, rows, pos };
}

// ---------------------------------------------------------------- provenance & reported findings

/** Plain-language name of the stain behind a block's numbers. */
export function assayLabel(method: string | undefined | null): string {
  if (!method) return "not scanned";
  return method.startsWith("virtual") ? "AI virtual PanCK from H&E" : "lab PanKeratin stain";
}

const MARGIN_RE = /margin|\b\d+(\.\d+)?\s*mm\s+(superior|inferior|anterior|posterior|lateral|medial)\b|<\s*\d/i;

/**
 * Margin findings as the pathology report states them, per slice: each entry of
 * slice.margins (split on " · ") that names a margin or a distance to one.
 * Extent notes, cavity notes and the Peninsula focus are not margin findings.
 */
export function reportedMarginFindings(slices: SliceMeta[]): { id: string; label: string; findings: string[] }[] {
  return slices
    .map((s) => ({
      id: s.id,
      label: s.label,
      findings: s.margins
        .flatMap((m) => m.split(" · "))
        .map((m) => m.trim())
        .filter((m) => MARGIN_RE.test(m) && !/extent/i.test(m))
        // A bare distance ("1 mm superior") reads as a size; say what it is measured to.
        .map((m) => m.replace(/^(\d+(?:\.\d+)?\s*mm)\s+(superior|inferior|anterior|posterior|lateral|medial)$/i, "$1 from $2 margin")),
    }))
    .filter((s) => s.findings.length > 0);
}
