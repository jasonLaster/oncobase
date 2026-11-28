import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  MISSING_CODE,
  SINGLE_CELL_MANIFEST_PATH,
  categoryColor,
  decodeArray,
  decodeLibrary,
  decodeLookup,
  drawOrder,
  expressionColor,
  groupStats,
  labelCounts,
  levelToValue,
  panelGene,
  pointColors,
  searchGenes,
  singleCellAssetUrl,
  validateManifest,
  type EncodedArray,
  type SingleCellLibraryFile,
} from "./data";
import { describeSingleCellView } from "./view-state";
import { singleCellTalkText } from "./talk-text";

// Synthetic data only: this repository is public.
function encode(array: Uint8Array | Uint16Array | Uint32Array): EncodedArray {
  const dtype = array instanceof Uint8Array ? "u8" : array instanceof Uint16Array ? "u16" : "u32";
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return { dtype, length: array.length, b64: Buffer.from(gzipSync(bytes)).toString("base64") };
}

function libraryFile(): SingleCellLibraryFile {
  // Four nuclei; two genes (A, B) in gene-major order.
  return {
    version: 1,
    library: "LIB-1",
    n: 4,
    bounds: [0, 1, 0, 1],
    coords: encode(new Uint16Array([0, 0, 65535, 65535, 32768, 0, 0, 65535])),
    categorical: { cellType: { labels: ["Tumor", "T cell"], codes: encode(new Uint8Array([0, 0, 1, MISSING_CODE])) } },
    genes: ["A", "B"],
    layers: {
      corrected: { max: [2, 4], values: encode(new Uint8Array([255, 0, 51, 0, 0, 0, 255, 255])) },
      raw: { max: [3, 5], values: encode(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 1])) },
    },
  };
}

describe("single-cell data", () => {
  test("asset URLs go through the gated file route", () => {
    expect(SINGLE_CELL_MANIFEST_PATH).toBe("sources/diagnostics/single-cell/manifest.json");
    expect(singleCellAssetUrl("manifest.json")).toBe(`/api/file?path=${encodeURIComponent(SINGLE_CELL_MANIFEST_PATH)}`);
    expect(singleCellAssetUrl("manifest.json", "abc123")).toContain("v=abc123");
  });

  test("decodes gzip+base64 little-endian columns", async () => {
    expect(Array.from(await decodeArray(encode(new Uint16Array([1, 513, 65535]))))).toEqual([1, 513, 65535]);
    expect(Array.from(await decodeArray(encode(new Uint32Array([7, 2 ** 31]))))).toEqual([7, 2 ** 31]);
    await expect(decodeArray({ ...encode(new Uint8Array([1, 2])), length: 3 })).rejects.toThrow();
  });

  test("decodes a library and slices panel genes per layer", async () => {
    const library = await decodeLibrary(libraryFile());
    expect(library.n).toBe(4);
    expect(Array.from(library.xy.slice(0, 4))).toEqual([0, 0, 1, 1]);
    expect(library.xy[4]).toBeCloseTo(0.5, 4);
    const a = panelGene(library, "A", "corrected")!;
    expect(Array.from(a.levels)).toEqual([255, 0, 51, 0]);
    expect(a.max).toBe(2);
    expect(Array.from(panelGene(library, "B", "raw")!.levels)).toEqual([0, 0, 0, 1]);
    expect(panelGene(library, "Z", "corrected")).toBeNull();
  });

  test("rejects libraries whose columns disagree with the nucleus count", async () => {
    const file = libraryFile();
    file.n = 5;
    await expect(decodeLibrary(file)).rejects.toThrow();
  });

  test("per-group % expressing and means skip unlabeled nuclei", async () => {
    const library = await decodeLibrary(libraryFile());
    const { codes, labels } = library.categories.cellType;
    const rows = groupStats(codes, labels, panelGene(library, "A", "corrected")!);
    expect(rows.map((r) => r.label)).toEqual(["Tumor", "T cell"]);
    const tumor = rows[0];
    expect(tumor.nuclei).toBe(2);
    expect(tumor.expressing).toBe(1);
    expect(tumor.pctExpressing).toBe(50);
    expect(tumor.mean).toBeCloseTo(1, 6); // (2 + 0) / 2
    expect(tumor.meanExpressing).toBeCloseTo(2, 6);
    expect(rows[1]).toMatchObject({ nuclei: 1, expressing: 1, pctExpressing: 100 });
    expect(rows[1].mean).toBeCloseTo(levelToValue(51, 2), 6);
    expect(labelCounts(codes, labels)).toEqual([2, 1]);
  });

  test("sparse lookup genes expand to dense levels", async () => {
    const lookup = await decodeLookup({
      version: 1, library: "LIB-1", n: 4, layer: "corrected", genes: ["X", "Y"], max: [1, 3],
      offsets: encode(new Uint32Array([0, 2, 3])), indices: encode(new Uint32Array([1, 3, 0])), levels: encode(new Uint8Array([9, 255, 4])),
    });
    expect(Array.from(lookup.gene("X")!.levels)).toEqual([0, 9, 0, 255]);
    expect(Array.from(lookup.gene("Y")!.levels)).toEqual([4, 0, 0, 0]);
    expect(lookup.gene("nope")).toBeNull();
  });

  test("colors: zero expression is the theme grey, highlight dims the rest, draw order puts signal on top", () => {
    const theme = { zero: [1, 2, 3] as [number, number, number], missing: [9, 9, 9] as [number, number, number] };
    const gene = pointColors(2, { kind: "gene", levels: new Uint8Array([0, 255]) }, theme);
    expect(Array.from(gene.slice(0, 4))).toEqual([1, 2, 3, 255]);
    expect(Array.from(gene.slice(4, 7))).toEqual(expressionColor(255));
    const cats = pointColors(3, { kind: "category", codes: new Uint8Array([0, 1, MISSING_CODE]), highlight: 1 }, theme);
    expect(Array.from(cats.slice(0, 4))).toEqual([9, 9, 9, 110]);
    expect(Array.from(cats.slice(4, 7))).toEqual(categoryColor(1));
    expect(Array.from(drawOrder(new Uint8Array([5, 0, 9, 1]), 4))).toEqual([1, 3, 0, 2]);
    expect(categoryColor(0)).not.toEqual(categoryColor(12));
  });

  test("gene search matches symbols and plain names, panel first", () => {
    const panel = [{ symbol: "TACSTD2", name: "TROP-2", group: "g" }, { symbol: "ERBB3", name: "HER3", group: "g" }];
    expect(searchGenes("trop", panel).map((h) => h.symbol)).toEqual(["TACSTD2"]);
    expect(searchGenes("her3", panel)[0]).toMatchObject({ symbol: "ERBB3", inPanel: true });
    expect(searchGenes("cd8", panel, ["CD8A", "ERBB3"])).toEqual([{ symbol: "CD8A", inPanel: false, rank: 3 }]);
    expect(searchGenes("  ", panel)).toEqual([]);
  });

  test("manifest validation, talk text and the spoken view state", () => {
    expect(() => validateManifest({ version: 2 })).toThrow();
    const manifest = validateManifest({
      version: 1, generatedAt: "2026-01-01T00:00:00Z", countsLayer: "cellbender",
      dataset: { title: "Synthetic map", summary: "Dots.", caveats: ["Research only."], sources: [{ label: "Source page", href: "/wiki/x" }] },
      colorings: [{ key: "cellType", label: "Cell type" }],
      genes: [{ symbol: "A", name: "Alpha", group: "Targets", why: "Because.", reliability: "caution", note: "Background." }],
      libraries: [{ id: "LIB-1", label: "LIB-1", file: "lib-1.json", qc: { nucleiCalled: 10, nucleiShown: 8, medianGenes: 100, medianUmis: 200, tumourNuclei: 4 } }],
    });
    const text = singleCellTalkText(manifest);
    expect(text).toContain("# Synthetic map");
    expect(text).toContain("LIB-1: 8 nuclei shown of 10 called");
    expect(text).toContain("A (Alpha): Because. Caution: Background.");
    expect(text).toContain("## What the words mean");
    expect(describeSingleCellView({})).toBe("");
    expect(describeSingleCellView({
      library: "LIB-1", gene: "A", geneName: "Alpha", layer: "raw", groupBy: "Cell type",
      rows: [{ label: "Tumor", nuclei: 1200, pctExpressing: 42.4, mean: 0.5 }],
    })).toBe("Library shown: LIB-1.\nSelected gene: A (Alpha), raw counts. The map is colored by its expression.\nBy Cell type: Tumor 42% of 1,200 nuclei expressing, mean 0.50.");
  });
});
