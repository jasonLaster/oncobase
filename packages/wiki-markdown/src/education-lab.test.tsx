import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdown } from "./index.tsx";
import { renderWikiMarkdownHtml, renderWikiMarkdownHtmlAsync } from "./server.ts";
import { resolveEducationLabSrc } from "./education-lab.ts";
import { resolveHref } from "./paths.ts";

const slug = "wiki/education/tools/index";
const src = "../cellular-therapies/tools/lab.html";
const expected = "/api/file?path=wiki%2Feducation%2Fcellular-therapies%2Ftools%2Flab.html";
const markdown = `<iframe data-education-lab title="Learning lab" src="${src}" srcdoc="unsafe" sandbox="allow-same-origin allow-scripts" allow="camera"></iframe>\n\n[Open lab](${src})`;

test("server and client render local learning labs with an opaque script sandbox", async () => {
  const renders = [renderWikiMarkdownHtml(markdown, slug), await renderWikiMarkdownHtmlAsync(markdown, slug),
    renderToStaticMarkup(createElement(WikiMarkdown, { content: markdown, currentSlug: slug }))];
  for (const html of renders) {
    expect(html).toContain(`src="${expected}"`);
    expect(html).toContain(`href="${expected}"`);
    expect(html).toContain('sandbox="allow-scripts allow-popups"');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    expect(html.toLowerCase()).not.toContain("srcdoc=");
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain('allow="camera"');
    expect(html).not.toContain("node=");
  }
  const client = renderToStaticMarkup(createElement(WikiMarkdown, { content: markdown, currentSlug: slug, apiBasePath: "/api/education" }));
  expect(client).toContain(`src="/api/education${expected}"`);
  expect(resolveHref(src, slug)).toBe(expected);
  expect(resolveHref("/sources/capture.html", slug)).toBe("/sources/capture.html");
});

test("static host adapters receive the resolved HTML iframe asset", () => {
  const seen: string[] = [];
  const html = renderWikiMarkdownHtml(markdown, slug, { resolveFrameSrc: value => {
    seen.push(value); return "/assets/wiki/education/cellular-therapies/tools/lab.html";
  } });
  expect(seen).toEqual([expected]);
  expect(html).toContain('src="/assets/wiki/education/cellular-therapies/tools/lab.html"');
});

test("marked lab frames reject remote URLs, private paths and traversal", () => {
  for (const source of ["https://example.com/lab.html", "//example.com/lab.html", "data:text/html,test", "javascript:alert(1)",
    "../../../care/lab.html", "/api/file?path=wiki/care/lab.html", "/api/file?path=wiki/education/../care/lab.html",
    "/api/file?path=wiki%2Feducation%2F%252e%252e%2Fcare%2Flab.html", "/api/file?path=wiki/education/lab.html&site=other",
    "/api/file?path=wiki/education/one.html&path=wiki/education/two.html", "tools/lab.zip", "/wiki/education/../../care/lab.html",
    "/wiki/education/tools\\lab.html", "/wiki/education/tools/%5Clab.html", ""]) {
    expect(() => resolveEducationLabSrc(source, slug)).toThrow("local HTML asset");
    expect(() => renderWikiMarkdownHtml(`<iframe data-education-lab src="${source}"></iframe>`, slug)).toThrow("local HTML asset");
  }
  expect(resolveEducationLabSrc("/api/education/file?path=wiki/education/lab.html#graph", slug)).toBe("/api/file?path=wiki%2Feducation%2Flab.html#graph");
  expect(renderWikiMarkdownHtml('<iframe title="Existing embed" src="https://example.com/video"></iframe>', slug))
    .toContain('src="https://example.com/video"');
});
