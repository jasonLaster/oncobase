import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { goals, matrix, matrixColumns, oncobasePieces, otherOpenSource, products, renderCompareMd } from "./compare-data";

const publicFile = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");

describe("compare data", () => {
  test("compare.md matches the data (run bun scripts/build-llms-txt.ts)", () => {
    expect(publicFile("compare.md")).toBe(renderCompareMd());
  });

  test("every matrix row has one cell per product, in column order", () => {
    expect(matrixColumns).toHaveLength(products.length);
    for (const row of matrix) expect(row.cells, row.label).toHaveLength(matrixColumns.length);
    for (const [index, id] of matrixColumns.entries()) expect(products[index]!.id).toBe(id);
  });

  test("every goal points at a known product", () => {
    const ids = new Set(products.map((product) => product.id));
    for (const goal of goals) {
      expect(ids.has(goal.pick), goal.id).toBe(true);
      for (const id of goal.also) expect(ids.has(id), goal.id).toBe(true);
    }
  });

  test("most goals send people to something simpler than Oncobase", () => {
    expect(goals.filter((goal) => goal.pick !== "oncobase").length).toBeGreaterThan(goals.length / 2);
  });

  test("compare.md lists every product, reusable piece, and the as-of date", () => {
    const text = renderCompareMd();
    for (const product of products) expect(text).toContain(product.name);
    for (const piece of [...oncobasePieces, ...otherOpenSource]) expect(text).toContain(piece.name);
    expect(text).toContain("October 2026");
  });
});
