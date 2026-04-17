import { describe, expect, test } from "bun:test";
import {
  buildExampleTablesDocument,
  exampleTables,
  renderExampleTableSection,
} from "@diana-tnbc/smart-table/examples";
import { renderMarkdown } from "./render-markdown";

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

describe("renderMarkdown example tables", () => {
  test("renders one wrapped table per example fixture", () => {
    const html = renderMarkdown(buildExampleTablesDocument(), "table-examples");

    expect(countMatches(html, /<div class="table-scroll-wrapper"><table/g)).toBe(
      exampleTables.length
    );
    expect(countMatches(html, /data-table-example="/g)).toBe(exampleTables.length);
    expect(html).toContain("Dense Comparison Matrix");
  });

  test("strips legacy table directives without removing the table", () => {
    const legacy = exampleTables.find(
      (example) => example.id === "legacy-directive-cleanup"
    );

    expect(legacy).toBeDefined();

    const html = renderMarkdown(
      renderExampleTableSection(legacy!),
      "table-examples/legacy-directive-cleanup"
    );

    expect(html).not.toContain("table-cols:");
    expect(html).toContain("<table");
    expect(html).toContain("data-table-example=\"legacy-directive-cleanup\"");
  });
});
