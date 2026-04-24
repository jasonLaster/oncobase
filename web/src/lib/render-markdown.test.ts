import { describe, expect, test } from "bun:test";
import {
  buildExampleTablesDocument,
  exampleTables,
  renderExampleTableSection,
} from "@diana-tnbc/smart-table/examples";
import { renderMarkdown } from "./render-markdown";
import { normalizeMathValue } from "./markdown-math";

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

  test("renders inline latex with katex after cleaning OCR-style syntax", () => {
    const html = renderMarkdown(
      "Dose escalation: $(n = 3$ and $50 - \\mu \\mathrm{g}$ and IFN $\\gamma$",
      "table-examples/inline-math"
    );

    expect(html).toContain('class="katex"');
    expect(html).not.toContain("$(n = 3$");
    expect(html).not.toContain("$50 - \\mu \\mathrm{g}$");
    expect(html).not.toContain("$\\gamma$");
  });
});

describe("normalizeMathValue", () => {
  test("repairs unbalanced parens and unit spacing from OCR output", () => {
    expect(normalizeMathValue("(n = 3")).toBe("(n = 3)");
    expect(normalizeMathValue("50 - \\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
    expect(normalizeMathValue("50~\\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
  });
});
