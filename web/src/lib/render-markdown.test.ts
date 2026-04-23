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

    expect(
      countMatches(
        html,
        /<div data-smart-table-shell class="smart-table-shell"><div data-smart-table-wrapper class="smart-table-wrapper table-scroll-wrapper"><table[^>]*class="smart-table"/g
      )
    ).toBe(
      exampleTables.length
    );
    expect(countMatches(html, /data-table-example="/g)).toBe(exampleTables.length);
    expect(html).toContain("Dense Comparison Matrix");
  });

  test("server-rendered markdown tables include smart-table section and cell classes", () => {
    const html = renderMarkdown(
      "| Name | Value |\n| --- | --- |\n| Alpha | Beta |",
      "table-examples/server-classes"
    );

    expect(html).toContain('data-smart-table-shell');
    expect(html).toContain('data-smart-table-wrapper');
    expect(html).toContain('class="smart-table"');
    expect(html).toContain('class="smart-table-header"');
    expect(html).toContain('class="smart-table-row"');
    expect(html).toContain('class="smart-table-head-cell"');
    expect(html).toContain('class="smart-table-cell"');
    expect(html).toContain('data-slot="table"');
    expect(html).toContain('data-slot="table-head"');
    expect(html).toContain('data-slot="table-cell"');
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
