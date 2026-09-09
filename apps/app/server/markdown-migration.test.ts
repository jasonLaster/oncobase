import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fromHtml } from "hast-util-from-html";
import { WikiMarkdown } from "@oncobase/wiki-markdown";
import { renderWikiMarkdownHtml } from "@oncobase/wiki-markdown/server";
import { renderHtmlFirstBody, renderHtmlFirstParts } from "./html-first-experiment";

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
function text(node: Node): string {
  return node.value ?? node.children?.map(text).join("") ?? "";
}
function elements(html: string, tagName: string): Node[] {
  const result: Node[] = [];
  function visit(node: Node) {
    if (node.tagName === tagName && !(node.properties?.className as string[] | undefined)?.includes("heading-anchor")) result.push(node);
    node.children?.forEach(visit);
  }
  visit(fromHtml(html, { fragment: true }) as Node);
  return result;
}
const page = (content: string, slug: string) => ({ slug, title: "Fixture", content, sensitive: false });
const renderers = {
  server: renderWikiMarkdownHtml,
  react: (content: string, slug: string) => renderToStaticMarkup(createElement(WikiMarkdown, { content, currentSlug: slug })),
  initial: (content: string, slug: string) => renderHtmlFirstBody(page(content, slug), "migration-test"),
  streamed: (content: string, slug: string) => { const parts = renderHtmlFirstParts(page(content, slug)); return parts.first + parts.rest(); },
};

for (const [name, render] of Object.entries(renderers)) {
  describe(`${name} reader link contracts`, () => {
    for (const [label, source, href] of [
      ["reported sensation link", "[[wiki/questions/surgery#How a smaller lumpectomy could affect sensation|Discussion]]", "/wiki/questions/surgery#how-a-smaller-lumpectomy-could-affect-sensation"],
      ["same-page heading", "[[#Local Heading|Jump]]", "#local-heading"],
      ["encoded heading", "[[wiki/notes.mdx#Local%20Heading|Jump]]", "/wiki/notes#local-heading"],
      ["unicode heading", "[[wiki/notes#Café follow-up|Jump]]", "/wiki/notes#caf%C3%A9-follow-up"],
      ["relative PDF page", "[[paper.pdf#page=3|Paper]]", "/api/file?path=wiki%2Fresearch%2Fpaper.pdf#page=3"],
      ["uppercase PDF", "[[paper.PDF|Paper]]", "/api/file?path=wiki%2Fresearch%2Fpaper.PDF"],
      ["encoded PDF name", "[Paper](paper%20one.pdf#page=3)", "/api/file?path=wiki%2Fresearch%2Fpaper%20one.pdf#page=3"],
      ["unbalanced route punctuation", "[[wiki/notes (draft|Notes]]", "/wiki/notes%20%28draft"],
      ["route with spaces", "[[about/log/June 2026|June]]", "/about/log/June%202026"],
      ["external PDF", "[Paper](https://example.com/paper.pdf#page=3)", "https://example.com/paper.pdf#page=3"],
      ["existing file API", "[Paper](/api/file?path=wiki%2Fpaper.pdf#page=3)", "/api/file?path=wiki%2Fpaper.pdf#page=3"],
      ["email", "[[redacted email]](mailto:reader@example.com)", "mailto:reader@example.com"],
    ]) {
      test(label!, () => {
        const links = elements(render(source!, "wiki/research/index"), "a");
        expect(links).toHaveLength(1);
        const actual = String(links[0]!.properties?.href).replace(/^#wiki-html-/, "#");
        expect(actual).toBe(href!);
      });
    }
    test("PDF page fragments do not become part of the displayed filename", () => {
      const links = elements(render("[Paper](paper.pdf#page=3)", "wiki/research/index"), "a");
      expect(text(links[0]!)).toBe("paper.pdf");
    });
    test("encoded image filenames are decoded once before file API encoding", () => {
      const images = elements(render("![Scan](images/scan%20one.png)", "wiki/research/index"), "img");
      expect(images[0]!.properties?.src).toBe("/api/file?path=wiki%2Fresearch%2Fimages%2Fscan%20one.png");
    });
    test("literal percent escapes in filenames are decoded only once", () => {
      const images = elements(render("![Scan](images/scan%2520one.png)", "wiki/research/index"), "img");
      expect(images[0]!.properties?.src).toBe("/api/file?path=wiki%2Fresearch%2Fimages%2Fscan%2520one.png");
    });
    test("HTML entities in asset names do not become part of the file path", () => {
      const images = elements(render("![Scan](images/a&b.png)", "wiki/research/index"), "img");
      expect(images[0]!.properties?.src).toBe("/api/file?path=wiki%2Fresearch%2Fimages%2Fa%26b.png");
    });
    test("malformed percent escapes in file API URLs do not crash rendering", () => {
      const links = elements(render('<a href="/api/file?path=bad%xx.pdf">Paper</a>', "wiki/research/index"), "a");
      expect(text(links[0]!)).toBe("bad%xx.pdf");
    });
    test("root-page assets resolve from the vault root", () => {
      const images = elements(render("![Scan](images/scan.png)", "index"), "img");
      expect(images[0]!.properties?.src).toBe("/api/file?path=images%2Fscan.png");
    });
    test("heading IDs preserve decoded text, inline formatting, and duplicate suffixes", () => {
      const html = render("## Risks & benefits\n\n## Risks & benefits\n\n## A `gene_name` & **next step**", "wiki/notes");
      expect(elements(html, "h2").map(node => String(node.properties?.id).replace(/^wiki-html-/, "")))
        .toEqual(["risks--benefits", "risks--benefits-1", "a-gene_name--next-step"]);
    });
  });
}
