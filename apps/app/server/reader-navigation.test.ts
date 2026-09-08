import { expect, test } from "bun:test";
import { renderReaderNavigation } from "./reader-navigation";
import { buildFileTreeFromManifest } from "@oncobase/wiki-content";

test("native file tree opens current ancestors and escapes labels and paths", () => {
  const tree = buildFileTreeFromManifest([{ slug: "index" }, { slug: "wiki/care/index" }, { slug: 'wiki/care/a<test>' }, { slug: "sources/paper" }]);
  const html = renderReaderNavigation(tree, "wiki/care/index");
  expect(html).toContain('data-folder="wiki" open');
  expect(html).toContain('data-folder="wiki/care" open');
  expect(html).toContain('data-folder="sources" href="/wiki/care/index?tree=sources"');
  expect(html).toContain('href="/wiki/care/index" aria-current="page"');
  expect(html).toContain('href="/wiki/care/a%3Ctest%3E">a&lt;test&gt;</a>');
  expect(html).toContain('href="/">index</a>');
});


test("collapsed folders keep the first response small and each branch is reachable by native links", () => {
  const tree = buildFileTreeFromManifest([{slug:"index"}, ...Array.from({length:6000}, (_, i) => ({slug:`sources/folder-${i}/page`}))]);
  const initial = renderReaderNavigation(tree, "index");
  expect(initial.length).toBeLessThan(500);
  expect(initial).toContain('href="/?tree=sources"');
  const opened = renderReaderNavigation(tree, "index", new URL("https://example.test/?tree=sources/folder-4"));
  expect(opened).toContain('data-folder="sources/folder-4" open');
  expect(opened).toContain('href="/sources/folder-4/page"');
});
