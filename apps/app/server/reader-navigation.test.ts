import { expect, test } from "bun:test";
import { renderReaderNavigation } from "./reader-navigation";
import { buildFileTreeFromManifest } from "@oncobase/wiki-content";

test("native file tree opens current ancestors and escapes labels and paths", () => {
  const tree = buildFileTreeFromManifest([{ slug: "index" }, { slug: "wiki/care/index" }, { slug: 'wiki/care/a<test>' }, { slug: "sources/paper" }]);
  const html = renderReaderNavigation(tree, "wiki/care/index");
  expect(html).toContain('data-folder="wiki" open');
  expect(html).toContain('data-folder="wiki/care" open');
  expect(html).toContain('data-folder="sources"><summary>sources</summary>');
  expect(html).toContain('href="/wiki/care/index" aria-current="page"');
  expect(html).toContain('href="/wiki/care/a%3Ctest%3E">a&lt;test&gt;</a>');
  expect(html).toContain('href="/">index</a>');
});
