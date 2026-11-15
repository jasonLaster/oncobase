import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { WikiMarkdown as BrowserWikiMarkdown, prepareWikiMarkdown } from "@oncobase/wiki-markdown/browser";
import { WikiMarkdown as FullWikiMarkdown, markdownRehypePlugins } from "@oncobase/wiki-markdown";
import { markdownLightRehypePlugins, markdownRemarkPlugins } from "@oncobase/wiki-markdown/math";
import { preloadMarkdownMath } from "@oncobase/wiki-markdown/math-loader";
import { documentMayNeedRawHtml, mayContainRawHtml, preloadRawHtml } from "@oncobase/wiki-markdown/raw-html-loader";
import { buildVault } from "../scripts/perf-lab/vault";

/**
 * The reader renders a document without raw HTML through wiki-markdown's light
 * pipeline (no rehype-raw / parse5; see packages/wiki-markdown/src/raw-html.ts).
 * On the vaults this app is tested and measured with, the reader must render
 * exactly what the full pipeline renders: the same HTML string (heading
 * anchors, sanitized URLs) and the same table source offsets, which table
 * persistence keys are built from.
 */

const FIXTURE_VAULT = path.resolve(import.meta.dir, "../scripts/fixtures/local-stack-vault");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return markdownFiles(file);
    return name.endsWith(".md") ? [file] : [];
  });
}

const body = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n/, "");

type Doc = { name: string; slug: string; content: string };

const fixtureDocs: Doc[] = markdownFiles(FIXTURE_VAULT).map((file) => {
  const slug = path.relative(FIXTURE_VAULT, file).replace(/\.md$/, "");
  return { name: `fixture:${slug}`, slug, content: body(readFileSync(file, "utf8")) };
});
// Every 20th perf-lab page, plus the measured article and the 279 KB page with 30 tables.
const perfDocs: Doc[] = buildVault().files
  .filter((file, index) => index % 20 === 0 || /^wiki\/treatment\/treatment-note-[012]\.md$/.test(file.file))
  .map((file) => {
    const slug = file.file.replace(/\.md$/, "");
    return { name: `perf:${slug}`, slug, content: body(file.content) };
  });
// The drug-tooltip journey's page, which needs the raw-HTML stage.
const drugTerm: Doc = {
  name: "drug-tooltip journey",
  slug: "wiki/examples/drug-tooltips",
  content: '# Drug tooltip fixture\n\n| Trial | Treatment |\n|---|---|\n| Example | <abbr data-tooltip="drug" data-name="Atezolizumab (Tecentriq)" title="Blocks PD-L1.">atezolizumab</abbr> |\n',
};
const docs = [...fixtureDocs, ...perfDocs, drugTerm];

const needsRaw = (doc: Doc) => mayContainRawHtml(prepareWikiMarkdown(doc.content, doc.slug, "/api"));
const render = (Component: typeof FullWikiMarkdown, doc: Doc) =>
  renderToStaticMarkup(<Component content={doc.content} currentSlug={doc.slug} apiBasePath="/api" />);

type Positioned = { type: string; tagName?: string; position?: { start?: { offset?: number } }; children?: Positioned[] };
function tableOffsets(plugins: unknown[], markdown: string) {
  const processor = unified().use(remarkParse).use(markdownRemarkPlugins as never)
    .use(remarkRehype, { allowDangerousHtml: true }).use(plugins as never);
  const offsets: Array<number | undefined> = [];
  const visit = (node: Positioned) => {
    if (node.type === "element" && node.tagName === "table") offsets.push(node.position?.start?.offset);
    node.children?.forEach(visit);
  };
  visit(processor.runSync(processor.parse(markdown)) as Positioned);
  return offsets;
}

beforeAll(async () => {
  // Load the optional stages so that a document needing one renders synchronously.
  await Promise.all([preloadRawHtml(), preloadMarkdownMath()]);
});

describe("wiki-markdown light pipeline on the app's vaults", () => {
  test("fixture and perf-lab pages need no raw HTML; the drug-term page does, and the boot hint says so", () => {
    expect(fixtureDocs.length).toBeGreaterThan(5);
    for (const doc of [...fixtureDocs, ...perfDocs]) expect({ doc: doc.name, raw: needsRaw(doc) }).toEqual({ doc: doc.name, raw: false });
    expect(needsRaw(drugTerm)).toBe(true);
    expect(documentMayNeedRawHtml(drugTerm.content)).toBe(true);
  });

  test("the reader's HTML equals the full pipeline's", () => {
    for (const doc of docs) {
      const expected = render(FullWikiMarkdown, doc);
      expect(expected).toContain("<");
      const actual = render(BrowserWikiMarkdown, doc);
      if (actual !== expected) {
        const at = [...actual].findIndex((char, index) => char !== expected[index]);
        throw new Error(`${doc.name} differs at ${at}:\n  reader: ${JSON.stringify(actual.slice(at - 40, at + 160))}\n  full:   ${JSON.stringify(expected.slice(at - 40, at + 160))}`);
      }
    }
  });

  test("tables keep the source offsets their persistence keys use", () => {
    let tables = 0;
    for (const doc of [...fixtureDocs, ...perfDocs]) {
      const prepared = prepareWikiMarkdown(doc.content, doc.slug, "/api");
      const expected = tableOffsets(markdownRehypePlugins, prepared);
      tables += expected.length;
      expect({ doc: doc.name, offsets: tableOffsets(markdownLightRehypePlugins, prepared) }).toEqual({ doc: doc.name, offsets: expected });
    }
    expect(tables).toBeGreaterThan(100);
  });
});
