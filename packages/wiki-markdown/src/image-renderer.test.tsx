import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DefaultWikiImage } from "./image-renderer";
test("article images do not create eager preload requests, while explicit eager images remain supported", () => {
  const html = renderToStaticMarkup(<DefaultWikiImage src="/figure.png" alt="Figure" />);
  expect(html).toContain('loading="lazy"'); expect(html).toContain('decoding="async"');
  expect(html).not.toContain('rel="preload"');
  const eager = renderToStaticMarkup(<DefaultWikiImage src="/figure.png" alt="Figure" loading="eager" decoding="sync" />);
  expect(eager).toContain('loading="eager"'); expect(eager).toContain('decoding="sync"');
});
