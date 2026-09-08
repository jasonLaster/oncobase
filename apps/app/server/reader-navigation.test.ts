import { expect, test } from "bun:test";
import { renderReaderNavigation } from "./reader-navigation";
import { buildFileTreeFromManifest } from "@oncobase/wiki-content";

test("native file tree opens current ancestors and escapes labels and paths", () => {
  const tree = buildFileTreeFromManifest([{ slug: "index" }, { slug: "wiki/care/index" }, { slug: 'wiki/care/a<test>' }, { slug: "sources/paper" }]);
  const html = renderReaderNavigation(tree, "wiki/care/index");
  expect(html).toContain('data-folder="wiki" open');
  expect(html).toContain('data-folder="wiki/care" open');
  expect(html).toContain('data-folder="sources" aria-expanded="false" href="/wiki/care/index?tree=sources"');
  expect(html).toContain('href="/wiki/care/index" aria-current="page"');
  expect(html).toContain('href="/wiki/care/a%3Ctest%3E"');
  expect(html).toContain('<span class="wiki-shell-tree-label">a&lt;test&gt;</span>');
  expect(html).toContain('href="/"');
});


test("collapsed folders keep the first response small and each branch is reachable by native links", () => {
  const tree = buildFileTreeFromManifest([{slug:"index"}, ...Array.from({length:6000}, (_, i) => ({slug:`sources/folder-${i}/page`}))]);
  const initial = renderReaderNavigation(tree, "index");
  expect(initial.length).toBeLessThan(5000);
  expect(initial).toContain('href="/?tree=sources"');
  const opened = renderReaderNavigation(tree, "index", new URL("https://example.test/?tree=sources/folder-4"));
  expect(opened).toContain('data-folder="sources/folder-4" open');
  expect(opened).toContain('href="/sources/folder-4/page"');
});

test("navigation cache shares public trees across instances and invalidates by site revision", async () => {
  const { createReaderNavigation } = await import("./reader-navigation");
  let queries = 0, fetches = 0;
  const sharedEntries = new Map<string, unknown>();
  const pending: Promise<unknown>[] = [];
  const client = { query: async () => { queries++; return { url: "https://snapshot.test/tree" }; } } as never;
  const options = {
    shared: { get: async (key: string) => sharedEntries.get(key), set: async (key: string, value: unknown) => { sharedEntries.set(key, value); } },
    background: (task: Promise<unknown>) => { pending.push(task); },
    fetchSnapshot: (async () => { fetches++; return Response.json({siteSlug:"diana", scope:"public", pages:[{slug:"wiki/public",sensitive:false},{slug:"private/hidden",sensitive:true}],assets:[]}); }),
  };
  const first = createReaderNavigation(client, options);
  const [tree, same] = await Promise.all([first("diana", "1"), first("diana", "1")]);
  expect(same).toEqual(tree);
  await Promise.all(pending);
  expect(JSON.stringify(tree)).not.toContain("private");
  expect(await createReaderNavigation(client, options)("diana", "1")).toEqual(tree);
  expect(queries).toBe(1); expect(fetches).toBe(1);
  await createReaderNavigation(client, options)("diana", "2");
  expect(fetches).toBe(2);
  await expect(createReaderNavigation(client, options)("other", "1")).rejects.toThrow("Invalid reader navigation snapshot");
});

test("a hanging shared cache is bounded and failed snapshots are retried", async () => {
  const { createReaderNavigation } = await import("./reader-navigation");
  let calls = 0;
  const client = { query: async () => { calls++; return calls === 1 ? null : {url:"https://snapshot.test/tree"}; } } as never;
  const read = createReaderNavigation(client, {
    shared: {get: () => new Promise(() => {}), set: async () => {throw Error("offline");}},
    background: task => { void task; },
    fetchSnapshot: (async () => Response.json({siteSlug:"diana",scope:"public",pages:[],assets:[]})),
  });
  await expect(read("diana", "1")).rejects.toThrow("unavailable");
  expect(await read("diana", "1")).toEqual([]);
  expect(calls).toBe(2);
});
