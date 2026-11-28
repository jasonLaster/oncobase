import { gzipSync } from "node:zlib";
import type { SingleCellLibraryFile, SingleCellManifest } from "../src/pages/single-cell/data";

// Synthetic numbers only: this repository is public, so nothing here comes from a real sample.
const LABELS = ["Tumor", "T cells", "Fibroblasts", "Macrophages"];
const CENTERS: [number, number][] = [[0.3, 0.6], [0.75, 0.75], [0.7, 0.25], [0.25, 0.2]];

function encode(array: Uint8Array | Uint16Array | Uint32Array) {
  const dtype = array instanceof Uint8Array ? "u8" : array instanceof Uint16Array ? "u16" : "u32";
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return { dtype, length: array.length, b64: Buffer.from(gzipSync(bytes)).toString("base64") } as const;
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function syntheticSingleCellLibrary(id: string, n: number, seed: number): SingleCellLibraryFile {
  const rand = random(seed);
  const coords = new Uint16Array(n * 2);
  const types = new Uint8Array(n);
  const status = new Uint8Array(n);
  const genes = ["GENEA", "GENEB", "GENEC"];
  const corrected = new Uint8Array(n * genes.length);
  const raw = new Uint8Array(n * genes.length);
  for (let i = 0; i < n; i++) {
    const t = i % LABELS.length;
    types[i] = t;
    status[i] = t === 0 ? 0 : 1;
    const [cx, cy] = CENTERS[t];
    const r = Math.sqrt(rand()) * 0.12;
    const a = rand() * Math.PI * 2;
    coords[i * 2] = Math.round(Math.min(1, Math.max(0, cx + r * Math.cos(a))) * 65535);
    coords[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, cy + r * Math.sin(a))) * 65535);
    // GENEA: tumor-high; GENEB: T-cell marker; GENEC: everywhere, low.
    corrected[i] = t === 0 ? 120 + Math.floor(rand() * 135) : rand() < 0.1 ? 10 : 0;
    corrected[n + i] = t === 1 && rand() < 0.7 ? 60 + Math.floor(rand() * 195) : 0;
    corrected[2 * n + i] = rand() < 0.4 ? 1 + Math.floor(rand() * 80) : 0;
    raw[i] = Math.min(255, corrected[i] + 20);
    raw[n + i] = corrected[n + i];
    raw[2 * n + i] = corrected[2 * n + i];
  }
  return {
    version: 1,
    library: id,
    n,
    bounds: [0, 10, 0, 10],
    coords: encode(coords),
    categorical: {
      cellType: { labels: LABELS, codes: encode(types) },
      tumour: { labels: ["tumour", "non-tumour"], codes: encode(status) },
    },
    genes,
    layers: {
      corrected: { max: [3.2, 2.5, 1.1], values: encode(corrected) },
      raw: { max: [3.6, 2.5, 1.1], values: encode(raw) },
    },
  };
}

export function syntheticSingleCellManifest(): SingleCellManifest {
  return {
    version: 1,
    generatedAt: "2026-01-02T00:00:00Z",
    countsLayer: "cellbender",
    dataset: {
      title: "Synthetic single-nucleus map",
      summary: "Synthetic nuclei for tests.",
      specimen: "A synthetic specimen.",
      labelSource: "Synthetic labels.",
      countsNote: "Synthetic counts.",
      caveats: ["Synthetic caveat."],
      sources: [{ label: "Synthetic source page", href: "/wiki/logistics/insurance" }],
    },
    colorings: [
      { key: "cellType", label: "Cell type", description: "Synthetic cell types." },
      { key: "tumour", label: "Tumor call" },
    ],
    genes: [
      { symbol: "GENEA", name: "Alpha target", group: "Drug targets", why: "Synthetic tumor target.", reliability: "interpretable" },
      { symbol: "GENEB", name: "Beta marker", group: "Cell identity", why: "Synthetic T-cell marker.", reliability: "caution", note: "Synthetic caution note." },
      { symbol: "GENEC", group: "Cell identity", why: "Synthetic housekeeping gene." },
    ],
    libraries: [
      { id: "LIB-1", label: "LIB-1", description: "First synthetic library.", file: "lib-1.json", qc: { nucleiCalled: 2600, nucleiShown: 2400, medianGenes: 2100, medianUmis: 3900, tumourNuclei: 600 } },
      { id: "LIB-2", label: "LIB-2", description: "Second synthetic library.", file: "lib-2.json", qc: { nucleiCalled: 1300, nucleiShown: 1200, medianGenes: 1800, medianUmis: 3100, tumourNuclei: 300 } },
    ],
  };
}

export const SYNTHETIC_SINGLE_CELL_FILES: Record<string, unknown> = {
  "manifest.json": syntheticSingleCellManifest(),
  "lib-1.json": syntheticSingleCellLibrary("LIB-1", 2400, 7),
  "lib-2.json": syntheticSingleCellLibrary("LIB-2", 1200, 11),
};
