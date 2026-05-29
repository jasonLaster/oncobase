import { describe, expect, test } from "bun:test";
import {
  buildExampleTablesDocument,
  exampleTables,
  renderExampleTableSection,
} from "@oncobase/smart-table/examples";
import { renderMarkdown } from "./render-markdown";
import { normalizeMathValue } from "./markdown-math";

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

describe("renderMarkdown example tables", () => {
  test("applies redaction tags before rendering", () => {
    const html = renderMarkdown(
      `Before

:::redact[Private discussion redacted.]
Secret section that should not render.
:::

After

Inline <redact label="someone">Diana Laster</redact> text.`,
      "redaction-example",
    );

    expect(html).toContain("Before");
    expect(html).toContain("Private discussion redacted.");
    expect(html).toContain("After");
    expect(html).toContain("Inline someone text.");
    expect(html).not.toContain("Secret section that should not render.");
    expect(html).not.toContain("Diana Laster");
    expect(html).not.toContain(":::redact");
    expect(html).not.toContain("<redact");
  });

  test("preserves Diana-facing labels while redacting full identifiers", () => {
    const html = renderMarkdown(
      "## Relevance to Diana\n\nDiana's treatment context mentions Diana Laster.",
      "wiki/relevance-example",
    );

    expect(html).toContain(">Relevance to Diana</h2>");
    expect(html).toContain("Diana's treatment context mentions the patient.");
    expect(html).not.toContain("Diana Laster");
    expect(html).not.toContain("Relevance to the patient");
  });

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

  test("does not render currency ranges as inline latex", () => {
    const html = renderMarkdown(
      "| Stage | Cost |\n| --- | --- |\n| 1 | ~$60,000 |\n| 3 | $50,000-$70,000 |\n| Total | $180,000-$200,000 |",
      "table-examples/currency-ranges"
    );

    expect(html).not.toContain('class="katex"');
    expect(html).toContain("~$60,000");
    expect(html).toContain("$50,000-$70,000");
    expect(html).toContain("$180,000-$200,000");
  });

  test("does not render compact budget amounts as inline latex", () => {
    const html = renderMarkdown(
      [
        "- **Echo all-in lands in the $350K–$600K range.**",
        "- **Valius — $50K Core or $150K Comprehensive (quoted).**",
        "- **Ranata bespoke molecule — $1M–$1.5M *if* triggered.**",
      ].join("\n"),
      "table-examples/compact-budget-currency"
    );

    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$350K–$600K");
    expect(html).toContain("$50K Core");
    expect(html).toContain("$150K Comprehensive");
    expect(html).toContain("$1M–$1.5M");
  });

  test("does not render malformed compact budget amounts as inline latex", () => {
    const html = renderMarkdown(
      [
        "- **Ranata bespoke molecule — $1M–1.5M *if* triggered.** Activated this week as parallel insurance, not a default branch.",
        "**Designing a bespoke ADC with Ranata also lands in the \\1M–$1.5M range** — but ideally won't be necessary.",
      ].join(" "),
      "table-examples/normalized-malformed-compact-budget-currency-v2"
    );

    expect(html).not.toContain("katex-error");
    expect(html).not.toContain('class="katex"');
    expect(countMatches(html, /\$1M–\$1\.5M/g)).toBe(2);
    expect(html).not.toContain("$1M–1.5M");
    expect(html).not.toContain("\\1M");
  });

  test("does not render budget placeholders as inline latex", () => {
    const html = renderMarkdown(
      "The budget is scenarios where we could spend $X, not commitments to spend $X.",
      "table-examples/budget-placeholder-currency"
    );

    expect(html).not.toContain('class="katex"');
    expect(html).toContain("spend $X");
    expect(html).toContain("spend $X.");
  });

  test("keeps numeric latex expressions renderable", () => {
    const html = renderMarkdown(
      "Dose escalation: $50 - \\mu \\mathrm{g}$ and $1 + 2 = 3$",
      "table-examples/numeric-latex"
    );

    expect(countMatches(html, /class="katex"/g)).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("$50 - \\mu \\mathrm{g}$");
    expect(html).not.toContain("$1 + 2 = 3$");
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

  test("renders reference-style links whose definition URL contains fallback-redacted terms", () => {
    const html = renderMarkdown(
      [
        "[P-RAD / TBCRC-053 TNBC cohort, ASCO 2026][prad-asco]",
        "",
        "[prad-asco]: /sources/research/papers/asco-abstracts/asco-2026-diana-schedule-and-people#p-rad--tbcrc-053-tnbc-cohort",
      ].join("\n"),
      "sources/research/papers/asco-abstracts/example",
    );

    expect(html).toContain(
      'href="/sources/research/papers/asco-abstracts/asco-2026-diana-schedule-and-people#p-rad--tbcrc-053-tnbc-cohort"',
    );
    expect(html).toContain(
      ">P-RAD / TBCRC-053 TNBC cohort, ASCO 2026</a>",
    );
    expect(html).not.toContain("[prad-asco]:");
    expect(html).not.toContain("the patient-schedule");
  });
});

describe("renderMarkdown theme-paired images", () => {
  test("proxies relative markdown PDF links through the file API", () => {
    const html = renderMarkdown(
      `**Original report:** [418-signatera.pdf](418-signatera.pdf)`,
      "sources/diagnostics/04-18-signatera-ctdna",
    );

    expect(html).toContain(
      `/api/file?path=${encodeURIComponent("sources/diagnostics/418-signatera.pdf")}`,
    );
    expect(html).toContain('class="pdf-chip"');
    expect(html).toContain("418-signatera.pdf");
    expect(html).not.toContain('href="418-signatera.pdf"');
  });

  test("expands data-theme-pair img into a light/dark sibling pair", () => {
    const html = renderMarkdown(
      `# Page\n\n<img src="./images/foo-light.png" alt="foo cartoon" data-theme-pair>\n`,
      "wiki/example",
    );

    expect(html).toMatch(/<img[^>]*foo-light\.png[^>]*class="dark:hidden"/);
    expect(html).toMatch(/<img[^>]*foo-dark\.png[^>]*class="hidden dark:block"/);
    expect(html).not.toContain("data-theme-pair");
    // alt is preserved on both tags
    expect(countMatches(html, /alt="foo cartoon"/g)).toBe(2);
    // both srcs get proxied through /api/file
    expect(html).toContain("/api/file?path=");
  });

  test("proxies vault-root theme-paired image paths without a leading slash", () => {
    const html = renderMarkdown(
      `<img src="/wiki/education/reading-a-tumor/images/t-cell-exclusion-mechanisms-light.png" alt="t cell exclusion cartoon" data-theme-pair>`,
      "wiki/questions/is-tumor-hot",
    );

    expect(html).toContain(
      `/api/file?path=${encodeURIComponent("wiki/education/reading-a-tumor/images/t-cell-exclusion-mechanisms-light.png")}`,
    );
    expect(html).toContain(
      `/api/file?path=${encodeURIComponent("wiki/education/reading-a-tumor/images/t-cell-exclusion-mechanisms-dark.png")}`,
    );
    expect(html).not.toContain(encodeURIComponent("/wiki/education"));
  });

  test("leaves the tag alone when src is not a -light variant", () => {
    const html = renderMarkdown(
      `<img src="./images/foo.png" alt="x" data-theme-pair>`,
      "wiki/example",
    );

    expect(html).toContain("data-theme-pair");
    expect(html).not.toContain("foo-dark.png");
    expect(html).not.toContain("dark:hidden");
  });

  test("ignores plain img tags without data-theme-pair", () => {
    const html = renderMarkdown(
      `<img src="./images/foo-light.png" alt="x">`,
      "wiki/example",
    );

    expect(html).not.toContain("foo-dark.png");
    expect(html).not.toContain("dark:hidden");
  });

  test("marks rendered images as theater-openable controls", () => {
    const html = renderMarkdown(
      `<img src="./images/foo.png" alt="Figure 1">`,
      "wiki/example",
    );

    expect(html).toContain("data-theater-image");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Open image: Figure 1"');
  });
});

describe("normalizeMathValue", () => {
  test("repairs unbalanced parens and unit spacing from OCR output", () => {
    expect(normalizeMathValue("(n = 3")).toBe("(n = 3)");
    expect(normalizeMathValue("50 - \\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
    expect(normalizeMathValue("50~\\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
  });
});
