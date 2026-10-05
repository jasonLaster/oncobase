import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DefaultWikiImage } from "./image-renderer";
import { WikiMarkdownRenderer } from "./renderer";
test("article images do not create eager preload requests, while explicit eager images remain supported", () => {
  const html = renderToStaticMarkup(<DefaultWikiImage src="/figure.png" alt="Figure" />);
  expect(html).toContain('loading="lazy"'); expect(html).toContain('decoding="async"');
  expect(html).not.toContain('rel="preload"');
  const eager = renderToStaticMarkup(<DefaultWikiImage src="/figure.png" alt="Figure" loading="eager" decoding="sync" />);
  expect(eager).toContain('loading="eager"'); expect(eager).toContain('decoding="sync"');
});

test("raw theme-paired cartoons retain both variants and hide the entire inactive preview", () => {
  const html = renderToStaticMarkup(<WikiMarkdownRenderer
    currentSlug="wiki/education/example"
    apiBasePath="/api/education"
    content={'<img src="/api/file?path=wiki%2Feducation%2Fimages%2Fexample-light.png" alt="example cartoon" data-theme-pair>'}
  />);
  expect(html).toContain('src="/api/file?path=wiki%2Feducation%2Fimages%2Fexample-light.png"');
  expect(html).toContain('src="/api/file?path=wiki%2Feducation%2Fimages%2Fexample-dark.png"');
  expect(html.match(/data-theme-variant="(?:light|dark)"/g)).toHaveLength(2);
  expect(html.match(/aria-label="Open image: example cartoon"/g)).toHaveLength(2);
  expect(html).not.toContain("data-theme-pair");
  expect(html).not.toContain("/api/education/api/file");
});

test("an unpaired image stays a single preview", () => {
  const html = renderToStaticMarkup(<WikiMarkdownRenderer content={'<img src="/figure.png" alt="figure" data-theme-pair>'} />);
  expect(html.match(/data-theater-image/g)).toHaveLength(1);
  expect(html).not.toContain("data-theme-variant");
});
