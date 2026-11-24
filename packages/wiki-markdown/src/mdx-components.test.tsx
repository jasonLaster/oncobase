import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdown } from "./index.tsx";
import { renderWikiMarkdownHtml } from "./server.ts";
import {
  expandWikiMdx,
  isWikiComponentAssetPath,
  parseComponentAttributes,
  resolveWikiComponentSrc,
  toPortableMarkdown,
  wikiMdxReferences,
} from "./mdx-components.ts";

const slug = "wiki/research/reviews/yield";
const page = `---
title: Yield
---
import YieldChart from "./components/yield-chart.html"
import { SlidesViewer, Missing } from "@oncobase/wiki-markdown"

# Yield

Intro paragraph.

<YieldChart height={450} title="Yield by specimen" fallback="./images/yield-chart.png" alt="Bar chart of yield" />

<SlidesViewer images={[{"src":"images/a.png","alt":"A"}]} />

\`\`\`mdx
import Nope from "./components/nope.html"
<YieldChart height={1} />
\`\`\`
`;
const frameSrc = "/api/file?path=wiki%2Fresearch%2Freviews%2Fcomponents%2Fyield-chart.html";

test("plain markdown is untouched", () => {
  const md = "# Title\n\nWe import data from \"x\" here.\n\n<div>raw</div>\n";
  expect(expandWikiMdx(md)).toBe(md);
  expect(toPortableMarkdown(md)).toBe(md);
});

test("props accept only literals", () => {
  expect(parseComponentAttributes(` height={450} title="A > B" ok data='x' list={[1,"two"]} obj={{"a":1}}`))
    .toEqual({ height: 450, title: "A > B", ok: true, data: "x", list: [1, "two"], obj: { a: 1 } });
  expect(() => parseComponentAttributes(" height={window.innerHeight}")).toThrow("literal");
  expect(() => parseComponentAttributes(" onClick={() => alert(1)}")).toThrow();
});

test("client and server render an imported HTML component as a sandboxed frame with a print fallback", () => {
  const client = renderToStaticMarkup(createElement(WikiMarkdown, { content: page, currentSlug: slug }));
  const server = renderWikiMarkdownHtml(page, slug);
  for (const html of [client, server]) {
    expect(html).toContain(`src="${frameSrc}"`);
    expect(html).toContain('sandbox="allow-scripts allow-popups"');
    expect(html).toContain('height="450"');
    expect(html).toContain('title="Yield by specimen"');
    expect(html).toContain("wiki-component-fallback");
    expect(html).toContain("yield-chart.png");
    expect(html).not.toContain("import YieldChart");
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("node=");
  }
  // Code fences keep their literal MDX.
  expect(client).toContain("import Nope from");
  // React registry: SlidesViewer resolves, unknown names explain themselves.
  expect(client).toContain("slides-viewer");
  expect(renderToStaticMarkup(createElement(WikiMarkdown, {
    content: 'import { Missing } from "@oncobase/wiki-markdown"\n\n<Missing />\n', currentSlug: slug,
  }))).toContain("Missing is not available");
});

test("hosts can register their own React components", () => {
  const Hello = ({ name }: { name: string }) => createElement("strong", null, `Hello ${name}`);
  const html = renderToStaticMarkup(createElement(WikiMarkdown, {
    content: 'import { Hello } from "@oncobase/wiki-markdown"\n\n<Hello name="Diana" />\n', currentSlug: slug, mdxComponents: { Hello },
  }));
  expect(html).toContain("<strong>Hello Diana</strong>");
});

test("copy-as-markdown swaps components for their fallback image", () => {
  const portable = toPortableMarkdown(page);
  expect(portable).not.toContain("import YieldChart");
  expect(portable).toContain("![Bar chart of yield](./images/yield-chart.png)");
  expect(portable).not.toContain("<SlidesViewer");
  expect(portable).toContain("import Nope from"); // fenced example survives
  expect(toPortableMarkdown('import C from "./components/c.html"\n\n<C title="Chart" />\n')).toContain("[Chart](./components/c.html)");
});

test("publisher references include component sources and fallbacks", () => {
  expect(wikiMdxReferences(page)).toEqual(["./components/yield-chart.html", "./images/yield-chart.png"]);
});

test("component sources must be local HTML inside a components folder", () => {
  expect(resolveWikiComponentSrc("./components/yield-chart.html", slug)).toBe(frameSrc);
  for (const bad of ["https://x.test/components/a.html", "//x/components/a.html", "./a.html", "./components/a.js",
    "../../../../components/a.html", "./components/a.html?x=1", "javascript:alert(1)", ""]) {
    expect(() => resolveWikiComponentSrc(bad, slug)).toThrow("components/");
  }
  expect(isWikiComponentAssetPath("wiki/x/components/a.html")).toBe(true);
  expect(isWikiComponentAssetPath("wiki/x/a.html")).toBe(false);
  expect(isWikiComponentAssetPath("wiki/x/components/../a.html")).toBe(false);
});

test("invalid imports and tags render visible errors instead of failing the page", () => {
  const html = renderWikiMarkdownHtml('import X from "https://evil.test/x.html"\nimport Y from "./components/y.html"\n\n<Y height={innerHeight} />\n', slug);
  expect(html).toContain("Component error: Unsupported import source");
  expect(html).not.toContain("<iframe");
  expect(html).toContain("Only literal props");
});

test("a named waterfall import renders both endpoints and signed changes from literal estimates", async () => {
  const md = `import { ScenarioWaterfall } from "@oncobase/wiki-markdown"

<ScenarioWaterfall
  domain={[50,90]}
  metrics={[{"label":"Primary"},{"label":"Secondary"}]}
  scenarios={[
    {"id":"a","label":"First","steps":[
      {"label":"Starting estimate","values":["65.0","60"]},
      {"label":"Adjustment","values":["64.5","61"]},
      {"label":"Result","values":["64.5","61"],"kind":"total"}
    ]},
    {"id":"b","label":"Second","steps":[{"label":"Other estimate","values":["65","62"]}]}
  ]}
/>`;
  const stream = await renderToReadableStream(createElement(WikiMarkdown, { content: md, currentSlug: slug }));
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain('aria-label="First"');
  expect(html).toContain('value="b"');
  expect(html).toContain('>65.0%</strong>');
  expect(html).toContain('aria-label="Primary: 64.5%, −0.5 pp"');
  expect(html).toContain('aria-label="Secondary: 61%, +1 pp"');
  expect(html).not.toContain("Component error");
});

const walkthrough = `import { ScenarioWalkthrough } from "@oncobase/wiki-markdown"

## Plan

<ScenarioWalkthrough
  label="Plan steps"
  domain={[50,90]}
  metrics={[{"label":"Primary","short":"P"},{"label":"Secondary","short":"S"}]}
  steps={[{"label":"Start","values":["60","55"]},{"label":"Drug","detail":"HR 0.76","values":["66","62.5"]}]}
>

- **Step 1.** Text with a [link](/wiki/other).

</ScenarioWalkthrough>

After.
`;

test("a wrapping component keeps its markdown as children, in copy and in static HTML", async () => {
  expect(toPortableMarkdown(walkthrough)).toBe("\n## Plan\n\n- **Step 1.** Text with a [link](/wiki/other).\n\nAfter.\n");
  const expanded = expandWikiMdx(walkthrough);
  expect(expanded).toContain("data-wiki-component-children>\n\n- **Step 1.**");
  expect(expanded).toMatch(/\n\n<\/figure>\n+After\./);

  const stream = await renderToReadableStream(createElement(WikiMarkdown, { content: walkthrough, currentSlug: slug }));
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).not.toContain("Component error");
  expect(html).toContain('aria-label="Primary: 66%, +6 pp"');
  expect(html).toContain('aria-label="Secondary: 62.5%, +7.5 pp"');
  expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Waterfall</);
  expect(html).toMatch(/class="scenario-walkthrough-text"[^>]*role="tabpanel"[^>]* hidden=""[^>]*>\s*<ul>\s*<li><strong>Step 1\.<\/strong>/);
  expect(html).not.toContain("wiki-component-fallback");

  const staticHtml = renderWikiMarkdownHtml(walkthrough, slug);
  expect(staticHtml).toMatch(/<div class="wiki-component-content">\s*<ul>\s*<li><strong>Step 1\.<\/strong>/);
  expect(staticHtml).not.toContain("data-wiki-component-props");
});

test("only React components wrap markdown; an unclosed wrapper is a visible error", () => {
  const html = renderWikiMarkdownHtml('import Y from "./components/y.html"\n\n<Y>\n\ntext\n\n</Y>\n', slug);
  expect(html).toContain("takes no children");
  const unclosed = renderWikiMarkdownHtml('import { ScenarioWalkthrough } from "@oncobase/wiki-markdown"\n\n<ScenarioWalkthrough steps={[]}>\n\ntext\n', slug);
  expect(unclosed).toContain("takes no children");
});
