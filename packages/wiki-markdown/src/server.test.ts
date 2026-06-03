import { describe, expect, test } from "bun:test";
import {
  buildExampleTablesDocument,
  exampleTables,
  renderExampleTableSection,
} from "@oncobase/smart-table/examples";
import { normalizeMathValue } from "./math";
import { renderWikiMarkdownHtml } from "./server";

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

describe("server markdown rendering", () => {
  test("renders one wrapped table per smart-table example fixture", () => {
    const html = renderWikiMarkdownHtml(buildExampleTablesDocument(), "table-examples");

    expect(
      countMatches(
        html,
        /<div data-smart-table-shell class="smart-table-shell"><div data-smart-table-wrapper class="smart-table-wrapper table-scroll-wrapper"><table[^>]*class="smart-table"/g,
      ),
    ).toBe(exampleTables.length);
    expect(countMatches(html, /data-table-example="/g)).toBe(exampleTables.length);
    expect(html).toContain("Dense Comparison Matrix");
  });

  test("decorates markdown tables with smart-table markup", () => {
    const html = renderWikiMarkdownHtml(`
| Scenario | Status |
| --- | --- |
| Cache first | Ready |
`);

    expect(html).toContain("data-smart-table-shell");
    expect(html).toContain("data-smart-table-wrapper");
    expect(html).toContain('class="smart-table');
    expect(html).toContain('class="smart-table-header"');
    expect(html).toContain('class="smart-table-row"');
    expect(html).toContain('class="smart-table-head-cell"');
    expect(html).toContain('data-slot="table-cell"');
  });

  test("strips legacy table directives without removing the table", () => {
    const legacy = exampleTables.find((example) => example.id === "legacy-directive-cleanup");
    expect(legacy).toBeDefined();

    const html = renderWikiMarkdownHtml(
      renderExampleTableSection(legacy!),
      "table-examples/legacy-directive-cleanup",
    );

    expect(html).not.toContain("table-cols:");
    expect(html).toContain("<table");
    expect(html).toContain('data-table-example="legacy-directive-cleanup"');
  });

  test("rewrites relative files and decorates PDFs as chips", () => {
    const html = renderWikiMarkdownHtml(
      `[Paper](paper.pdf)\n\n![Scan](images/scan.png)`,
      "wiki/research/index",
    );

    expect(html).toContain(
      'href="/api/file?path=wiki%2Fresearch%2Fpaper.pdf" class="pdf-chip"',
    );
    expect(html).toContain("<span>paper.pdf</span>");
    expect(html).toContain('src="/api/file?path=wiki%2Fresearch%2Fimages%2Fscan.png"');
    expect(html).toContain("data-theater-image");
  });

  test("turns numeric bracket citations into links to references", () => {
    const html = renderWikiMarkdownHtml(`
Clinically significant complications are rare [1-3].

## References

1. One
2. Two
3. Three
`);

    expect(html).toContain('href="#references"');
    expect(html).toContain('class="citation-ref"');
    expect(html).toContain(">[1-3]</a>");
    expect(html).toContain(">References</h2>");
  });

  test("turns LaTeX cite commands into links to references", () => {
    const html = renderWikiMarkdownHtml(`
This matches prior work \\cite{Smith2026, Jones2025}.

## References

1. Smith 2026
2. Jones 2025
`);

    expect(html).toContain('href="#references"');
    expect(html).toContain(">[Smith2026, Jones2025]</a>");
  });

  test("turns inline superscript citations into links to references", () => {
    const html = renderWikiMarkdownHtml(`
The recurrence rate declines rapidly thereafter^{1}. Neoantigens^{2,3} can still be targeted.

## References

1. One
2. Two
3. Three
`);

    expect(html).toContain('thereafter<sup><a href="#references" class="citation-ref"');
    expect(html).toContain(">1</a></sup>");
    expect(html).toContain('Neoantigens<sup><a href="#references"');
    expect(html).toContain(">2,3</a></sup>");
  });

  test("adds a references anchor before numbered bibliographies without a heading", () => {
    const html = renderWikiMarkdownHtml(`
The recurrence rate declines rapidly thereafter^{1}.

# Online content

1. One
2. Two
3. Three
`);

    expect(html).toContain('href="#references"');
    expect(html).toContain('id="references"');
    expect(html).toContain(">References</h2>");
  });

  test("does not rewrite non-citation superscripts or ordinary numbered lists", () => {
    const nonCitationHtml = renderWikiMarkdownHtml(`
CD4^{+} T cells expand, while ^{68}Ga tracers stay unchanged.

## References

1. One
`);
    const listHtml = renderWikiMarkdownHtml("1. First\n2. Second\n3. Third");

    expect(nonCitationHtml).not.toContain("citation-ref");
    expect(nonCitationHtml).toContain("CD4^{+}");
    expect(nonCitationHtml).toContain("^{68}Ga");
    expect(listHtml).not.toContain('id="references"');
    expect(listHtml).not.toContain("citation-ref");
  });

  test("expands theme-paired images", () => {
    const html = renderWikiMarkdownHtml(
      `<img src="./images/pathway-light.png" alt="pathway" data-theme-pair>`,
      "wiki/diagnostics/pathway",
    );

    expect(html).toContain("pathway-light.png");
    expect(html).toContain("pathway-dark.png");
    expect(html).toContain('class="dark:hidden"');
    expect(html).toContain('class="hidden dark:block"');
    expect(countMatches(html, /alt="pathway"/g)).toBe(2);
    expect(html).toContain("/api/file?path=");
    expect(html).not.toContain("data-theme-pair");
  });

  test("leaves non-light theme pair images alone", () => {
    const html = renderWikiMarkdownHtml(
      `<img src="./images/pathway.png" alt="pathway" data-theme-pair>`,
      "wiki/diagnostics/pathway",
    );

    expect(html).toContain("data-theme-pair");
    expect(html).not.toContain("pathway-dark.png");
    expect(html).not.toContain("dark:hidden");
  });

  test("marks rendered images as theater-openable controls", () => {
    const html = renderWikiMarkdownHtml(
      `<img src="./images/foo.png" alt="Figure 1">`,
      "wiki/example",
    );

    expect(html).toContain("data-theater-image");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Open image: Figure 1"');
  });

  test("renders a slides viewer from a marked markdown image list", () => {
    const html = renderWikiMarkdownHtml(
      [
        "<!-- slides -->",
        "- ![First scan](images/first.png)",
        "- ![Second scan](images/second.png)",
        "## Why It Matters",
      ].join("\n"),
      "wiki/research/index",
    );

    expect(html).toContain('class="wiki-slides-viewer"');
    expect(html).toContain("data-wiki-slides");
    expect(countMatches(html, /data-wiki-slide(?:\s|>|="")/g)).toBe(2);
    expect(html).toContain("1 / 2");
    expect(html).toContain("data-wiki-slides-prev");
    expect(html).toContain("data-wiki-slides-next");
    expect(html).toContain(
      'src="/api/file?path=wiki%2Fresearch%2Fimages%2Ffirst.png"',
    );
    expect(html).toContain(
      'src="/api/file?path=wiki%2Fresearch%2Fimages%2Fsecond.png"',
    );
    expect(html).toContain('id="why-it-matters"');
    expect(html).toContain(">Why It Matters</h2>");
    expect(html).not.toContain("## Why It Matters");
  });

  test("preserves currency and still renders math", () => {
    const html = renderWikiMarkdownHtml([
      "Cost is $1.5M and math is $x^2$.",
      "Budget range: $350K-$600K and $1M-1.5M.",
      "Dose: $50 - \\mu \\mathrm{g}$ and $1 + 2 = 3$.",
    ].join("\n\n"));

    expect(html).toContain("$1.5M");
    expect(html).toContain("$350K-$600K");
    expect(html).toContain("$1M-$1.5M");
    expect(countMatches(html, /class="katex"/g)).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("$50 - \\mu \\mathrm{g}$");
  });

  test("repairs unbalanced parens and unit spacing before KaTeX render", () => {
    expect(normalizeMathValue("(n = 3")).toBe("(n = 3)");
    expect(normalizeMathValue("50 - \\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
    expect(normalizeMathValue("50~\\mu \\mathrm{g}")).toBe("50\\,\\mu\\mathrm{g}");
  });
});
