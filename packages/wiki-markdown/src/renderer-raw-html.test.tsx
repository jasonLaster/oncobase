import { beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { WikiMarkdown as BrowserWikiMarkdown } from "./browser.tsx";
import { WikiMarkdown as FullWikiMarkdown } from "./index.tsx";
import { preloadMarkdownMath } from "./math-loader.ts";
import { prepareWikiMarkdown } from "./prepare.ts";
import { isRawComment, mayContainRawHtml } from "./raw-html.ts";
import { documentMayNeedRawHtml, loadedRawHtmlPlugin, preloadRawHtml } from "./raw-html-loader.ts";

/**
 * The browser reader renders a document without raw HTML through a light
 * pipeline (no rehype-raw / parse5). These tests prove it against the full,
 * synchronous pipeline (`index.tsx`, which every SSR consumer uses, and which
 * the browser reader used for every document before): the same HTML string,
 * heading anchors and sanitized URLs included, and the same table positions
 * that table persistence keys come from. The same comparison over the
 * fixture and perf-lab vaults lives with them, in
 * apps/app/src/markdown-raw-html.test.tsx.
 */

// Documents that exercise the raw-HTML decision from both sides.
const edgeCases: Record<string, string> = {
  plain: "# Title\n\nA paragraph with **bold**, `code`, a [link](/wiki/a) and [[Wiki Link|alias]].",
  "less-than in prose": "Values a < b and 3<5, x <= y, and <5 mm nodules.",
  autolinks: "See <https://example.org/a?b=c> or <person@example.org>.",
  "html inside code": "Use `<div>` here.\n\n```html\n<section><b>bold</b></section>\n```\n\n    <i>indented</i>\n",
  "block comment": "Intro.\n\n<!-- TODO: remove this -->\n\nOutro.\n",
  "inline comment": "Before <!-- note --> after.",
  "comment with trailing text": "<!-- note --> trailing words\n\nNext.",
  "multi-line comment": "<!--\nline one\nline two\n-->\n\n## Heading after\n",
  "comment hiding a tag": "`<!--` then <b>real</b> -->",
  "unterminated comment": "Start <!-- never closed\n\nNext paragraph.",
  "abrupt comment": "<!-->\n\nText.",
  "drug term": '| Trial | Treatment |\n|---|---|\n| Example | <abbr data-tooltip="drug" data-name="Atezolizumab (Tecentriq)" title="Blocks PD-L1.">atezolizumab</abbr> |\n',
  details: "<details>\n<summary>More</summary>\n\nHidden **markdown**.\n\n</details>\n",
  image: '<img src="figures/scan.png" alt="scan" width="300">\n\nCaption.',
  "unsafe url": '[bad](javascript:alert(1)) and <a href="javascript:alert(2)">raw</a>',
  "iframe lab": '<iframe data-education-lab src="../cellular-therapies/tools/lab.html"></iframe>',
  citations: "A finding.[^1]\n\n[^1]: Smith et al. 2024.\n",
  "numeric citations": "Response rates rose [1] and fell [2].\n\n## References\n\n1. First.\n2. Second.\n",
  math: "Dose $RDI = \\frac{a}{b}$ and cost $1,200.\n\n$$\nx^2\n$$\n",
  currency: "It costs $5 and $10.50, or $1M.",
  "tables and headings": "## Results\n\n| A | B |\n|---|---:|\n| 1 | 2 |\n\n## Results\n\n| C |\n|---|\n| 3 |\n",
  gfm: "~~gone~~ www.example.com\n\n- [x] done\n- [ ] todo\n",
  mermaid: "```mermaid\ngantt\n  title Plan\n  Task A: a1, 2024-01-01, 1d\n```\n",
  callout: "> [!question] One question\n> Ask when radiation starts.\n\n> [!note]- Folded\n> Hidden.\n\n> [!tip]+ Expanded\n> Shown.\n",
  columns: ':::columns{tone="benefit cost"}\n### Left\nOne.\n### Right\nTwo.\n:::\n',
  figure: "```figure\ntype: bars\norientation: vertical\nunit: \"%\"\ndata:\n  - { label: Year 1, value: 41, tone: cost }\ncaption: By year.\n```\n",
  "page-break": "First page.\n\n<!-- page-break -->\n\nSecond page.\n",
};

type Doc = { name: string; content: string; slug?: string };

// A page shaped like the reader's ordinary articles: headings, links, tables,
// a blockquote and footnotes, with no HTML.
const article = [
  "# Treatment note", "", "Intro paragraph with [a link](/wiki/a) and [[Wiki Link]].", "",
  ...Array.from({ length: 4 }, (_, s) => [
    `## Section ${s}`, "", "Body text for the section.[^" + (s + 1) + "]", "",
    "- [First](/wiki/one) — note", "- [Second](/wiki/two) — note", "",
    "| Date | Marker | Value |", "| --- | --- | ---: |",
    ...Array.from({ length: 5 }, (_, r) => `| 2026-0${r + 1}-01 | CA 15-3 | ${r * 7}.5 |`), "",
    "> A quoted line.", "",
  ]).flat(),
  ...Array.from({ length: 4 }, (_, s) => `[^${s + 1}]: Source ${s + 1}.`),
].join("\n");

const edgeDocs: Doc[] = Object.entries(edgeCases).map(([name, content]) => ({ name: `edge:${name}`, slug: "wiki/education/tools/index", content }));
const docs: Doc[] = [{ name: "article", slug: "wiki/treatment/note", content: article }, ...edgeDocs];

type Positioned = { type: string; tagName?: string; position?: { start?: { offset?: number } }; children?: Positioned[] };
function tableOffsets(tree: Positioned) {
  const offsets: Array<number | undefined> = [];
  const visit = (node: Positioned) => {
    if (node.type === "element" && node.tagName === "table") offsets.push(node.position?.start?.offset);
    node.children?.forEach(visit);
  };
  visit(tree);
  return offsets;
}

function render(Component: typeof FullWikiMarkdown, doc: Doc) {
  return renderToStaticMarkup(<Component content={doc.content} currentSlug={doc.slug} apiBasePath="/api" />);
}

beforeAll(async () => {
  // The browser reader renders a raw-HTML or math document once its stage has
  // loaded; load both up front so every document renders synchronously here.
  await Promise.all([preloadRawHtml(), preloadMarkdownMath()]);
});

describe("raw-HTML detection", () => {
  test("documents with HTML, or comments it cannot prove inert, take the full pipeline", () => {
    const needsRaw = (name: string) => mayContainRawHtml(prepareWikiMarkdown(edgeCases[name]!, "wiki/education/tools/index", "/api"));
    for (const name of ["drug term", "details", "image", "unsafe url", "iframe lab", "comment with trailing text", "comment hiding a tag", "abrupt comment", "numeric citations", "html inside code", "inline comment"]) {
      expect({ name, raw: needsRaw(name) }).toEqual({ name, raw: true });
    }
    expect(mayContainRawHtml(prepareWikiMarkdown(article, "wiki/treatment/note", "/api"))).toBe(false);
    for (const name of ["plain", "less-than in prose", "autolinks", "block comment", "multi-line comment", "math", "currency", "gfm", "tables and headings", "mermaid", "callout", "columns", "figure", "page-break"]) {
      expect({ name, raw: needsRaw(name) }).toEqual({ name, raw: false });
    }
  });

  test("the boot hint flags every document the renderer will load rehype-raw for", () => {
    for (const doc of docs) {
      if (!mayContainRawHtml(prepareWikiMarkdown(doc.content, doc.slug, "/api"))) continue;
      expect({ doc: doc.name, hint: documentMayNeedRawHtml(doc.content) }).toEqual({ doc: doc.name, hint: true });
    }
  });

  test("in a light document every raw node is a complete comment", () => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
    for (const doc of docs) {
      const prepared = prepareWikiMarkdown(doc.content, doc.slug, "/api");
      if (mayContainRawHtml(prepared)) continue;
      const html: Array<{ type: string; value?: string }> = [];
      const visit = (node: { type: string; value?: string; children?: unknown[] }) => {
        if (node.type === "html") html.push(node);
        (node.children as typeof node[] | undefined)?.forEach(visit);
      };
      visit(processor.parse(prepared));
      for (const node of html) expect({ doc: doc.name, comment: isRawComment({ type: "raw", value: node.value }) }).toEqual({ doc: doc.name, comment: true });
    }
  });
});

describe("renders exactly as the full pipeline", () => {
  test("the browser reader's HTML equals the full pipeline's, with and without raw HTML", () => {
    expect(loadedRawHtmlPlugin()).toBeDefined();
    let light = 0;
    let raw = 0;
    for (const doc of docs) {
      if (mayContainRawHtml(prepareWikiMarkdown(doc.content, doc.slug, "/api"))) raw++;
      else light++;
      const expected = render(FullWikiMarkdown, doc);
      expect(expected.length).toBeGreaterThan(0);
      const actual = render(BrowserWikiMarkdown, doc);
      if (actual !== expected) {
        const at = [...actual].findIndex((char, index) => char !== expected[index]);
        throw new Error(`${doc.name} differs at ${at}:\n  browser: ${JSON.stringify(actual.slice(at - 10, at + 200))}\n  full:    ${JSON.stringify(expected.slice(at - 10, at + 200))}`);
      }
    }
    expect(light).toBeGreaterThan(10);
    expect(raw).toBeGreaterThan(10);
  });

  test("tables keep the source offsets their persistence keys use", async () => {
    const { markdownRehypePlugins } = await import("./rehype-plugins.ts");
    const { markdownLightRehypePlugins } = await import("./math-common.ts");
    const remarkRehype = (await import("remark-rehype")).default;
    const offsets = (plugins: unknown[], markdown: string) => {
      const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
        .use(remarkRehype, { allowDangerousHtml: true }).use(plugins as never);
      return tableOffsets(processor.runSync(processor.parse(markdown)) as Positioned);
    };
    let tables = 0;
    for (const doc of docs) {
      const prepared = prepareWikiMarkdown(doc.content, doc.slug, "/api");
      if (mayContainRawHtml(prepared)) continue;
      const expected = offsets(markdownRehypePlugins, prepared);
      tables += expected.length;
      expect({ doc: doc.name, offsets: offsets(markdownLightRehypePlugins, prepared) }).toEqual({ doc: doc.name, offsets: expected });
    }
    expect(tables).toBeGreaterThan(5);
  });
});
