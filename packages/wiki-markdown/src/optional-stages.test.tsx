import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdown } from "./browser.tsx";
import { loadedMathPlugin } from "./math-loader.ts";
import { loadedRawHtmlPlugin } from "./raw-html-loader.ts";
import { preloadOptionalMarkdownStages } from "./optional-stages.ts";

// Runs without a DOM, as a server render does: WikiMarkdown loads these stages
// in effects, so only a preload makes the first render the document itself.
const math = "Dose intensity is $RDI = \\frac{a}{b}$ over the cycle.";
const html = "Before <details><summary>More</summary>Hidden</details> after.";

test("a math document renders its math once its stage is preloaded", async () => {
  if (!loadedMathPlugin()) {
    expect(renderToStaticMarkup(<WikiMarkdown content={math} loadingFallback={<p>loading</p>} />)).toBe("<p>loading</p>");
  }
  await preloadOptionalMarkdownStages(math, "wiki/a");
  const rendered = renderToStaticMarkup(<WikiMarkdown content={math} loadingFallback={<p>loading</p>} />);
  expect(rendered).toContain('class="katex"');
  expect(rendered).not.toContain("loading");
});

test("a document with raw HTML renders it once its stage is preloaded", async () => {
  await preloadOptionalMarkdownStages(html, "wiki/a");
  expect(loadedRawHtmlPlugin()).toBeDefined();
  expect(renderToStaticMarkup(<WikiMarkdown content={html} loadingFallback={<p>loading</p>} />)).toContain("<summary>More</summary>");
});

test("a plain document needs neither stage", async () => {
  await preloadOptionalMarkdownStages("Just **text**.", "wiki/a");
  expect(renderToStaticMarkup(<WikiMarkdown content="Just **text**." loadingFallback={<p>loading</p>} />)).toContain("<strong>text</strong>");
});
