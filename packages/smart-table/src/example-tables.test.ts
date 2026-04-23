import { describe, expect, test } from "bun:test";
import {
  buildExampleTablesDocument,
  exampleTables,
  featuredExampleTables,
  getExampleTable,
  renderMarkdownTable,
  resizeAuditExampleTables,
} from "./example-tables";

describe("example table fixtures", () => {
  test("use unique ids, metadata, and consistent row widths", () => {
    const ids = new Set<string>();

    for (const example of exampleTables) {
      expect(ids.has(example.id)).toBe(false);
      ids.add(example.id);
      expect(example.headers.length).toBeGreaterThan(1);
      expect(example.rows.length).toBeGreaterThan(0);
      expect(example.category.length).toBeGreaterThan(0);
      expect(example.recommendedChecks.length).toBeGreaterThan(0);
      expect(example.apiModes.length).toBeGreaterThan(0);

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
      expect(doc).toContain(`- Category: ${example.category}`);
      expect(doc).toContain(`- API modes: ${example.apiModes.join(", ")}`);
    }
  });

  test("expose stable featured and resize-audit subsets", () => {
    expect(featuredExampleTables.length).toBeGreaterThan(2);
    expect(resizeAuditExampleTables.length).toBeGreaterThan(2);

    for (const example of featuredExampleTables) {
      expect(getExampleTable(example.id)).toBe(example);
    }

    for (const example of resizeAuditExampleTables) {
      expect(example.apiModes).toContain("declarative");
      expect(getExampleTable(example.id)).toBe(example);
    }
  });
});
