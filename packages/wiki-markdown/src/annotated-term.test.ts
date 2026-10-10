import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdownRenderer } from "./renderer";
import { renderWikiMarkdownHtml } from "./server";

test("authored drug explanations survive server HTML and become accessible client pills", () => {
  const content = '<abbr data-tooltip="drug" data-name="Example drug" data-category="Immunotherapy" data-target="PD-L1" data-effect="Immune activation" title="Blocks an immune brake.">Example</abbr>';
  const server = renderWikiMarkdownHtml(content);
  expect(server).toContain('title="Blocks an immune brake."');
  expect(server).toContain('data-target="PD-L1"');
  const client = renderToStaticMarkup(createElement(WikiMarkdownRenderer, { content }));
  expect(client).toContain('aria-label="About Example drug"');
  expect(client).toContain('class="wiki-drug-badge"');
  expect(client).not.toContain('title="Blocks an immune brake."');
});

test("ordinary abbreviations and code labels keep their existing semantics", () => {
  const client = renderToStaticMarkup(createElement(WikiMarkdownRenderer, {
    content: '<abbr title="circulating tumor DNA">ctDNA</abbr> and `positive ctDNA`',
  }));
  expect(client).toContain('<abbr title="circulating tumor DNA">ctDNA</abbr>');
  expect(client).toContain('<code>positive ctDNA</code>');
  expect(client).not.toContain('wiki-drug-badge');
});
