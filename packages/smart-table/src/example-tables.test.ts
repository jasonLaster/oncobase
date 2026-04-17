import { describe, expect, test } from "bun:test";
import {
  buildExampleTablesDocument,
  exampleTables,
  renderMarkdownTable,
} from "./example-tables";

describe("example table fixtures", () => {
  test("use unique ids and consistent row widths", () => {
    const ids = new Set<string>();

    for (const example of exampleTables) {
      expect(ids.has(example.id)).toBe(false);
      ids.add(example.id);
      expect(example.headers.length).toBeGreaterThan(1);
      expect(example.rows.length).toBeGreaterThan(0);

      for (const row of example.rows) {
        expect(row.length).toBe(example.headers.length);
      }
    }
  });

  test("render markdown tables with the expected number of lines", () => {
    for (const example of exampleTables) {
      const markdown = renderMarkdownTable(example);
      const lines = markdown.trim().split("\n");

      expect(lines).toHaveLength(example.rows.length + 2);
      expect(lines[0]?.startsWith("| ")).toBe(true);
      expect(lines[1]?.includes("---")).toBe(true);
    }
  });

  test("build a combined markdown document with one section per fixture", () => {
    const doc = buildExampleTablesDocument();

    expect(doc).toContain("A controlled set of table fixtures");
    for (const example of exampleTables) {
      expect(doc).toContain(`data-table-example="${example.id}"`);
      expect(doc).toContain(`## ${example.title}`);
    }
  });
});
