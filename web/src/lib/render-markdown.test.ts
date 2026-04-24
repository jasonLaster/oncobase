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

  test("turns numeric bracket citations into links to the references section", () => {
    const html = renderMarkdown(
      "Clinically significant complications are rare [1-3].\n\n## References\n\n1. One\n2. Two\n3. Three",
      "citations/numeric"
    );

    expect(html).toContain('href="#references"');
    expect(html).toContain('class="citation-ref"');
    expect(html).toContain(">References</h2>");
    expect(html).toContain(">[1-3]</a>");
  });

  test("turns LaTeX cite commands into links to the references section", () => {
    const html = renderMarkdown(
      "This matches prior work \\cite{Smith2026, Jones2025}.\n\n## References\n\n1. Smith 2026\n2. Jones 2025",
      "citations/latex"
    );

    expect(html).toContain('href="#references"');
    expect(html).toContain(">[Smith2026, Jones2025]</a>");
  });

  test("turns inline superscript citations into links to the references section", () => {
    const html = renderMarkdown(
      "The recurrence rate declines rapidly thereafter^{1}. Neoantigens^{2,3} can still be targeted.\n\n## References\n\n1. One\n2. Two\n3. Three",
      "citations/superscript"
    );

    expect(html).toContain('href="#references"');
    expect(html).toContain('thereafter<sup><a href="#references" class="citation-ref"');
    expect(html).toContain(">1</a></sup>");
    expect(html).toContain("Neoantigens<sup><a href=\"#references\"");
    expect(html).toContain(">2,3</a></sup>");
  });

  test("adds a references anchor before numbered bibliographies without a references heading", () => {
    const html = renderMarkdown(
      "The recurrence rate declines rapidly thereafter^{1}.\n\n# Online content\n\n1. One\n2. Two\n3. Three",
      "citations/generated-heading"
    );

    expect(html).toContain('href="#references"');
    expect(html).toContain('id="references"');
    expect(html).toContain(">References</h2>");
    expect(html).toContain("thereafter<sup><a href=\"#references\"");
  });

  test("does not rewrite non-citation superscripts", () => {
    const html = renderMarkdown(
      "CD4^{+} T cells expand, while ^{68}Ga tracers stay unchanged.\n\n## References\n\n1. One",
      "citations/non-citation-superscript"
    );

    expect(html).not.toContain("citation-ref");
    expect(html).toContain("CD4^{+}");
    expect(html).toContain("^{68}Ga");
  });

  test("does not add a references anchor for ordinary numbered lists", () => {
    const html = renderMarkdown(
      "1. First\n2. Second\n3. Third",
      "citations/plain-numbered-list"
    );

    expect(html).not.toContain('id="references"');
    expect(html).not.toContain("citation-ref");
  });

  test("preserves gfm footnotes", () => {
    const html = renderMarkdown(
      "Alpha[^1]\n\n[^1]: Citation body",
      "citations/footnote"
    );

    expect(html).toContain('data-footnote-ref=""');
    expect(html).toContain('data-footnote-backref=""');
  });
});

describe("normalizeMathValue", () => {
  test("repairs unbalanced parens and unit spacing from OCR output", () => {
    expect(normalizeMathValue("(n = 3")).toBe("(n = 3)");
    expect(normalizeMathValue("50 - \\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
    expect(normalizeMathValue("50~\\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
  });
});
