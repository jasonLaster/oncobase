import { assetHref } from "../../wiki-assets";

/**
 * Data contract for the single-cell viewer. The files are written by
 * `scripts/prepare-single-cell-viewer.py` into a vault folder whose sensitive
 * index page links (and so owns) every file: `/api/file` serves them only to
 * roles that can read that page, and the reader lists the page only for them.
 */
export const SINGLE_CELL_ASSET_BASE = "sources/diagnostics/single-cell";
export const SINGLE_CELL_MANIFEST_PATH = `${SINGLE_CELL_ASSET_BASE}/manifest.json`;
/** The sensitive page that owns the data files. */
export const SINGLE_CELL_OWNER_SLUG = `${SINGLE_CELL_ASSET_BASE}/index`;
export const SINGLE_CELL_FORMAT_VERSION = 1;
/** Categorical code for "no label". */
export const MISSING_CODE = 255;
const LEVELS = 255;
const COORD_LEVELS = 65535;

export type EncodedArray = { dtype: "u8" | "u16" | "u32" | "f32"; length: number; b64: string };

export type SingleCellGene = {
  symbol: string;
  name?: string;
  group: string;
  why?: string;
  reliability?: "interpretable" | "caution";
  note?: string;
};

export type SingleCellColoring = { key: string; label: string; description?: string };

export type SingleCellQc = {
  nucleiCalled: number;
  nucleiShown: number;
  medianGenes: number | null;
  medianUmis: number | null;
  medianUmisCorrected?: number | null;
  tumourNuclei?: number;
  doubletsRemoved?: number;
  droppedByReason?: Record<string, number>;
};

export type SingleCellVendorQc = Partial<Record<
  "cells" | "medianGenesPerCell" | "medianUmisPerCell" | "totalGenesDetected" | "meanReadsPerCell" |
  "sequencingSaturation" | "readsInCells" | "intronicFraction" | "reads",
  number
>>;

export type SingleCellLibraryMeta = {
  id: string;
  label: string;
  description?: string;
  file: string;
  lookupFile?: string | null;
  qc: SingleCellQc;
  vendorQc?: SingleCellVendorQc | null;
};

export type SingleCellManifest = {
  version: number;
  generatedAt: string;
  dataset: {
    title: string;
    summary?: string;
    specimen?: string;
    labelSource?: string;
    countsNote?: string;
    caveats?: string[];
    sources?: { label: string; href: string }[];
  };
  countsLayer: string;
  colorings: SingleCellColoring[];
  genes: SingleCellGene[];
  glossary?: { term: string; meaning: string }[];
  libraries: SingleCellLibraryMeta[];
};

type EncodedCategorical = { labels: string[]; codes: EncodedArray };
type EncodedLayer = { max: number[]; values: EncodedArray };

export type SingleCellLibraryFile = {
  version: number;
  library: string;
  n: number;
  bounds: [number, number, number, number];
  coords: EncodedArray;
  categorical: Record<string, EncodedCategorical>;
  genes: string[];
  layers: Record<"corrected" | "raw", EncodedLayer>;
};

export type SingleCellLookupFile = {
  version: number;
  library: string;
  n: number;
  layer: "corrected";
  genes: string[];
  max: number[];
  offsets: EncodedArray;
  indices: EncodedArray;
  levels: EncodedArray;
};

export type CountsLayer = "corrected" | "raw";

/** One library, decoded: unit-square coordinates, label codes and gene levels. */
export type SingleCellLibrary = {
  id: string;
  n: number;
  /** Interleaved x, y in [0, 1]. */
  xy: Float32Array;
  categories: Record<string, { labels: string[]; codes: Uint8Array }>;
  genes: string[];
  layers: Record<CountsLayer, { max: number[]; levels: Uint8Array }>;
};

export type GeneValues = { levels: Uint8Array; max: number };

export function singleCellAssetPath(file: string) {
  return `${SINGLE_CELL_ASSET_BASE}/${file}`;
}

export function singleCellAssetUrl(file: string, contentHash?: string | null) {
  return assetHref(singleCellAssetPath(file), contentHash);
}

function base64Bytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** An encoded column as its typed array (little-endian, as written by the builder). */
export async function decodeArray(encoded: EncodedArray): Promise<Uint8Array | Uint16Array | Uint32Array | Float32Array> {
  const buffer = await gunzip(base64Bytes(encoded.b64));
  const view = new DataView(buffer);
  const make = {
    u8: () => new Uint8Array(buffer),
    u16: () => Uint16Array.from({ length: buffer.byteLength / 2 }, (_, i) => view.getUint16(i * 2, true)),
    u32: () => Uint32Array.from({ length: buffer.byteLength / 4 }, (_, i) => view.getUint32(i * 4, true)),
    f32: () => Float32Array.from({ length: buffer.byteLength / 4 }, (_, i) => view.getFloat32(i * 4, true)),
  }[encoded.dtype];
  if (!make) throw new Error(`Unsupported column type ${encoded.dtype}`);
  const array = make();
  if (array.length !== encoded.length) throw new Error("Column length does not match its header");
  return array;
}

export function validateManifest(value: unknown): SingleCellManifest {
  const manifest = value as SingleCellManifest;
  if (!manifest || manifest.version !== SINGLE_CELL_FORMAT_VERSION || !Array.isArray(manifest.libraries) ||
    manifest.libraries.length === 0 || !Array.isArray(manifest.genes) || !Array.isArray(manifest.colorings)) {
    throw new Error("This single-cell dataset uses a format this viewer does not read.");
  }
  return manifest;
}

export async function decodeLibrary(file: SingleCellLibraryFile): Promise<SingleCellLibrary> {
  if (file.version !== SINGLE_CELL_FORMAT_VERSION) throw new Error("Unsupported library format");
  const coords = await decodeArray(file.coords);
  if (coords.length !== file.n * 2) throw new Error("Coordinate count does not match nuclei");
  const xy = new Float32Array(coords.length);
  for (let i = 0; i < coords.length; i++) xy[i] = coords[i] / COORD_LEVELS;
  const categoryEntries = Object.entries(file.categorical);
  const layerKeys = ["corrected", "raw"] as const;
  const [codeColumns, levelColumns] = await Promise.all([
    Promise.all(categoryEntries.map(([, value]) => decodeArray(value.codes))),
    Promise.all(layerKeys.map((key) => decodeArray(file.layers[key].values))),
  ]);
  const categories: SingleCellLibrary["categories"] = {};
  categoryEntries.forEach(([key, value], i) => {
    const codes = codeColumns[i] as Uint8Array;
    if (codes.length !== file.n) throw new Error(`Label column ${key} does not match nuclei`);
    categories[key] = { labels: value.labels, codes };
  });
  const layers = {} as SingleCellLibrary["layers"];
  layerKeys.forEach((key, i) => {
    const levels = levelColumns[i] as Uint8Array;
    if (levels.length !== file.n * file.genes.length) throw new Error(`Expression layer ${key} has the wrong size`);
    layers[key] = { max: file.layers[key].max, levels };
  });
  return { id: file.library, n: file.n, xy, categories, genes: file.genes, layers };
}

/** The panel's gene-major levels for one gene, or null when it is not in the panel. */
export function panelGene(library: SingleCellLibrary, symbol: string, layer: CountsLayer): GeneValues | null {
  const index = library.genes.indexOf(symbol);
  if (index < 0) return null;
  const { levels, max } = library.layers[layer];
  return { levels: levels.subarray(index * library.n, (index + 1) * library.n), max: max[index] ?? 0 };
}

/** Sparse lookup genes, decoded on demand. */
export type SingleCellLookup = { genes: string[]; gene: (symbol: string) => GeneValues | null };

export async function decodeLookup(file: SingleCellLookupFile): Promise<SingleCellLookup> {
  const [offsets, indices, levels] = await Promise.all([decodeArray(file.offsets), decodeArray(file.indices), decodeArray(file.levels)]);
  if (offsets.length !== file.genes.length + 1) throw new Error("Lookup offsets do not match genes");
  return {
    genes: file.genes,
    gene(symbol) {
      const index = file.genes.indexOf(symbol);
      if (index < 0) return null;
      const dense = new Uint8Array(file.n);
      for (let k = offsets[index]; k < offsets[index + 1]; k++) dense[indices[k]] = levels[k];
      return { levels: dense, max: file.max[index] ?? 0 };
    },
  };
}

/** Level 0..255 back to log-normalized expression (log1p of counts per 10,000). */
export function levelToValue(level: number, max: number) {
  return (level / LEVELS) * max;
}

export type GroupStat = {
  label: string;
  code: number;
  nuclei: number;
  expressing: number;
  pctExpressing: number;
  /** Mean log-normalized expression over all nuclei in the group. */
  mean: number;
  /** Mean among nuclei with any counts. */
  meanExpressing: number;
};

/** % expressing and mean expression of one gene in each label group, largest groups first. */
export function groupStats(codes: Uint8Array, labels: string[], gene: GeneValues): GroupStat[] {
  const nuclei = new Array<number>(labels.length).fill(0);
  const expressing = new Array<number>(labels.length).fill(0);
  const sums = new Array<number>(labels.length).fill(0);
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === MISSING_CODE || code >= labels.length) continue;
    nuclei[code]++;
    const level = gene.levels[i];
    if (level > 0) {
      expressing[code]++;
      sums[code] += levelToValue(level, gene.max);
    }
  }
  return labels
    .map((label, code) => ({
      label,
      code,
      nuclei: nuclei[code],
      expressing: expressing[code],
      pctExpressing: nuclei[code] ? (100 * expressing[code]) / nuclei[code] : 0,
      mean: nuclei[code] ? sums[code] / nuclei[code] : 0,
      meanExpressing: expressing[code] ? sums[code] / expressing[code] : 0,
    }))
    .filter((row) => row.nuclei > 0)
    .sort((a, b) => b.nuclei - a.nuclei);
}

/** Nucleus counts per label. */
export function labelCounts(codes: Uint8Array, labels: string[]) {
  const counts = new Array<number>(labels.length).fill(0);
  for (const code of codes) if (code < labels.length) counts[code]++;
  return counts;
}

// Categorical palette: 12 hues that stay distinguishable on light and dark
// backgrounds, then cycled with lowered lightness for long label lists.
const PALETTE = [
  "#e15759", "#4e79a7", "#59a14f", "#f28e2b", "#b07aa1", "#76b7b2",
  "#edc948", "#ff9da7", "#9c755f", "#5b8ff9", "#8cd17d", "#d37295",
];

export function categoryColor(code: number): [number, number, number] {
  const hex = PALETTE[code % PALETTE.length];
  const shade = Math.floor(code / PALETTE.length) % 3;
  const factor = [1, 0.72, 1.18][shade];
  return [1, 3, 5].map((offset) => Math.min(255, Math.round(parseInt(hex.slice(offset, offset + 2), 16) * factor))) as [number, number, number];
}

export function rgbCss([r, g, b]: [number, number, number]) {
  return `rgb(${r} ${g} ${b})`;
}

// Expression ramp (perceptually ordered, viridis-like); level 0 uses the theme's "no counts" grey.
const RAMP: [number, [number, number, number]][] = [
  [0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 145, 140]], [0.75, [94, 201, 98]], [1, [253, 231, 37]],
];

export function expressionColor(level: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, level / LEVELS));
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const f = (t - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
      const a = RAMP[i - 1][1];
      const b = RAMP[i][1];
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export const EXPRESSION_GRADIENT_CSS = `linear-gradient(to right, ${RAMP.map(([stop, rgb]) => `${rgbCss(rgb)} ${stop * 100}%`).join(", ")})`;

/**
 * Per-point RGBA colors for the scatter. A highlighted label dims the others;
 * expression draws non-expressing nuclei in `zero` so the signal reads on top.
 */
export function pointColors(
  n: number,
  mode: { kind: "category"; codes: Uint8Array; highlight?: number | null } | { kind: "gene"; levels: Uint8Array },
  theme: { zero: [number, number, number]; missing: [number, number, number] },
): Uint8Array {
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let rgb: [number, number, number];
    let alpha = 255;
    if (mode.kind === "category") {
      const code = mode.codes[i];
      rgb = code === MISSING_CODE ? theme.missing : categoryColor(code);
      if (mode.highlight != null && code !== mode.highlight) {
        rgb = theme.missing;
        alpha = 110;
      }
    } else {
      const level = mode.levels[i];
      rgb = level === 0 ? theme.zero : expressionColor(level);
    }
    colors.set([rgb[0], rgb[1], rgb[2], alpha], i * 4);
  }
  return colors;
}

/** Draw order for gene mode: zeros first, then increasing expression, so high values stay on top. */
export function drawOrder(levels: Uint8Array | null, n: number): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  if (!levels) return order;
  return order.sort((a, b) => levels[a] - levels[b]);
}

/** Case-insensitive gene search over symbols and plain names; exact symbol matches first. */
export function searchGenes(query: string, panel: SingleCellGene[], lookup: string[] = []) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const panelSymbols = new Set(panel.map((gene) => gene.symbol));
  const hits: { symbol: string; name?: string; inPanel: boolean; rank: number }[] = [];
  for (const gene of panel) {
    const symbol = gene.symbol.toLowerCase();
    const name = gene.name?.toLowerCase() ?? "";
    const rank = symbol === q || name === q ? 0 : symbol.startsWith(q) || name.startsWith(q) ? 1 : symbol.includes(q) || name.includes(q) ? 2 : -1;
    if (rank >= 0) hits.push({ symbol: gene.symbol, name: gene.name, inPanel: true, rank });
  }
  for (const symbol of lookup) {
    if (panelSymbols.has(symbol)) continue;
    const s = symbol.toLowerCase();
    const rank = s === q ? 0 : s.startsWith(q) ? 3 : -1;
    if (rank >= 0) hits.push({ symbol, inPanel: false, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol)).slice(0, 12);
}

export function formatCount(value: number | null | undefined) {
  return value == null ? "—" : Math.round(value).toLocaleString("en-US");
}
