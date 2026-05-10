import { describe, expect, test } from "bun:test";
import { renderWikiMarkdownHtml } from "./server";

describe("server markdown rendering", () => {
  test("decorates markdown tables with smart-table markup", () => {
    const html = renderWikiMarkdownHtml(`
| Scenario | Status |
| --- | --- |
| Cache first | Ready |
`);

    expect(html).toContain("data-smart-table-shell");
    expect(html).toContain('class="smart-table');
    expect(html).toContain('data-slot="table-cell"');
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

  test("links citations and anchors generated references", () => {
    const html = renderWikiMarkdownHtml(`
Finding [1].

1. PMID evidence
2. Second source
3. Third source
`);

    expect(html).toContain('class="citation-ref"');
    expect(html).toContain('id="references"');
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
    expect(html).not.toContain("data-theme-pair");
  });

  test("preserves currency while rendering math", () => {
    const html = renderWikiMarkdownHtml("Cost is $1.5M and math is $x^2$.");

    expect(html).toContain("$1.5M");
    expect(html).toContain("katex");
  });
});
