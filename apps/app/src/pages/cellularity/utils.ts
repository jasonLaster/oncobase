import { assetHref } from "../../wiki-assets";
import type { BlockGrid, RcbParams } from "./types";

export const CELLULARITY_ASSET_BASE = "sources/diagnostics/cellularity";

export const CELLULARITY_DATA_URL = assetHref(
  `${CELLULARITY_ASSET_BASE}/data.json`,
);

export function cellularityAssetUrl(filename: string): string {
  return assetHref(`${CELLULARITY_ASSET_BASE}/${filename}`);
}

const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.0, [246, 244, 239]],
  [0.18, [253, 224, 210]],
  [0.42, [250, 152, 114]],
  [0.7, [224, 72, 40]],
  [1.0, [138, 18, 22]],
];

/** Power-normalized Reds color scale (gamma 0.45 over 0..35%) so 1-5% fields remain visible. */
export function heatColor(pct: number): string {
  const t = Math.pow(Math.max(0, Math.min(pct, 35)) / 35, 0.45);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (t <= HEAT_STOPS[i][0]) {
      const f =
        (t - HEAT_STOPS[i - 1][0]) / (HEAT_STOPS[i][0] - HEAT_STOPS[i - 1][0]);
      const a = HEAT_STOPS[i - 1][1];
      const b = HEAT_STOPS[i][1];
      const r = Math.round(a[0] + (b[0] - a[0]) * f);
      const g = Math.round(a[1] + (b[1] - a[1]) * f);
      const bl = Math.round(a[2] + (b[2] - a[2]) * f);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return "rgb(138,18,22)";
}

/** Standard Symmans et al. (JCO 2007) Residual Cancer Burden formula. */
export function calcRcbNodalTerm(positiveNodes: number, maxMetMm: number): number {
  if (positiveNodes <= 0 || maxMetMm <= 0) return 0;
  return Math.pow(4 * (1 - Math.pow(0.75, positiveNodes)) * maxMetMm, 0.17);
}

export function calcRCB(caPct: number, params: RcbParams) {
  const dPrim = Math.sqrt(Math.max(0, params.d1_mm) * Math.max(0, params.d2_mm));
  const fInv = (1 - (params.pct_in_situ ?? 0) / 100) * (Math.max(0, caPct) / 100);
  const prim = fInv > 0 && dPrim > 0 ? 1.4 * Math.pow(fInv * dPrim, 0.17) : 0;
  const nodal = calcRcbNodalTerm(params.positive_nodes, params.max_met_mm);
  return { prim, nodal, total: prim + nodal };
}

export function rcbClass(index: number): { label: string; tone: "ok" | "red" } {
  if (index <= 0) return { label: "RCB-0 (pCR)", tone: "ok" };
  if (index <= 1.36) return { label: "RCB-I", tone: "ok" };
  if (index <= 3.28) return { label: "RCB-II", tone: "ok" };
  return { label: "RCB-III", tone: "red" };
}

export type GridGeometry = {
  ox: number;
  oy: number;
  cell: number;
  fieldMap: Map<string, number>;
};

export function draw2DGrid(
  canvas: HTMLCanvasElement,
  g: BlockGrid,
  opts: {
    showBed?: boolean;
    showNums?: boolean;
    small?: boolean;
    highlightSet?: Set<string>;
    hoverCell?: [number, number] | null;
  } = {},
): GridGeometry {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.parentElement?.clientWidth || canvas.width || 420;
  const aspect = Math.max(0.56, Math.min(0.82, g.rows / g.cols));
  const cssH = opts.small
    ? 140
    : Math.round(Math.min(310, Math.max(220, cssW * aspect)));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  const fieldMap = new Map<string, number>();
  if (!ctx) return { ox: 0, oy: 0, cell: 1, fieldMap };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = opts.small ? 8 : 16;
  const cell = Math.min(
    (cssW - 2 * pad) / g.cols,
    (cssH - 2 * pad) / g.rows,
  );
  const ox = (cssW - g.cols * cell) / 2;
  const oy = (cssH - g.rows * cell) / 2;

  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (g.tissue[r]?.[c]) {
        ctx.fillStyle = "#efede6";
        ctx.fillRect(ox + c * cell, oy + r * cell, cell + 0.3, cell + 0.3);
      }
    }
  }

  for (const [c, r, ca] of g.fields) {
    fieldMap.set(`${c},${r}`, ca);
    ctx.fillStyle = heatColor(ca);
    ctx.fillRect(ox + c * cell, oy + r * cell, cell - 0.3, cell - 0.3);
  }

  if (opts.showBed) {
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        if (!g.bed[r]?.[c]) continue;
        const x = ox + c * cell;
        const y = oy + r * cell;
        if (r === 0 || !g.bed[r - 1]?.[c]) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + cell, y);
        }
        if (r === g.rows - 1 || !g.bed[r + 1]?.[c]) {
          ctx.moveTo(x, y + cell);
          ctx.lineTo(x + cell, y + cell);
        }
        if (c === 0 || !g.bed[r]?.[c - 1]) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cell);
        }
        if (c === g.cols - 1 || !g.bed[r]?.[c + 1]) {
          ctx.moveTo(x + cell, y);
          ctx.lineTo(x + cell, y + cell);
        }
      }
    }
    ctx.stroke();
  }

  if (opts.highlightSet) {
    ctx.strokeStyle = "#d49b00";
    ctx.lineWidth = 1.5;
    for (const key of opts.highlightSet) {
      const [cStr, rStr] = key.split(",");
      const c = Number(cStr);
      const r = Number(rStr);
      ctx.strokeRect(
        ox + c * cell + 0.5,
        oy + r * cell + 0.5,
        cell - 1,
        cell - 1,
      );
    }
  }

  if (opts.showNums && cell >= 7.5) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${cell >= 12 ? "600 8.5px" : "600 6.5px"} -apple-system, sans-serif`;
    for (const [c, r, ca] of g.fields) {
      if (ca >= 1) {
        ctx.fillStyle = ca >= 12 ? "#fff" : "#161614";
        ctx.fillText(
          String(Math.round(ca)),
          ox + (c + 0.5) * cell,
          oy + (r + 0.5) * cell + 0.5,
        );
      }
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  if (opts.hoverCell) {
    const [hc, hr] = opts.hoverCell;
    ctx.strokeStyle = "#161614";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + hc * cell, oy + hr * cell, cell, cell);
  }

  return { ox, oy, cell, fieldMap };
}
