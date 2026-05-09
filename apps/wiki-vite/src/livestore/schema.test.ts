import { afterEach, describe, expect, test } from "bun:test";
import { makeInMemoryAdapter } from "@livestore/adapter-web";
import { createStorePromise } from "@livestore/livestore";
import { events, schema } from "./schema";
import {
  fileTree$,
  pageContentBySlug$,
  pageIndex$,
  siteState$,
  stalePageContent$,
} from "./queries";

const stores: Array<{ shutdown: () => Promise<void> }> = [];

async function makeStore() {
  const store = await createStorePromise({
    schema,
    storeId: `test-${crypto.randomUUID()}`,
    adapter: makeInMemoryAdapter(),
    disableDevtools: true,
  });
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.shutdown()));
});

describe("wiki vite LiveStore schema", () => {
  test("materializes manifests and page bodies", async () => {
    const store = await makeStore();
    store.commit(
      events.manifestApplied({
        siteSlug: "diana",
        scope: "public",
        manifestHash: "manifest-hash",
        generatedAt: "2026-05-09T12:00:00.000Z",
        receivedAt: 1,
        manifestSize: 100,
        compactTreeJson: JSON.stringify([["f", "index"]]),
        pagesJson: JSON.stringify([
          {
            slug: "index",
            title: "Index",
            tags: ["summary"],
            description: "Home",
            contentHash: "page-hash",
            sensitive: false,
            size: 12,
          },
        ]),
        assetsJson: JSON.stringify([]),
      }),
      events.pageContentFetched({
        slug: "index",
        title: "Index",
        content: "# Hello",
        tags: ["summary"],
        contentHash: "page-hash",
        sensitive: false,
        size: 7,
        fetchedAt: 2,
      }),
    );

    expect(store.query(siteState$)?.manifestHash).toBe("manifest-hash");
    expect(store.query(fileTree$)?.treeJson).toContain("index");
    expect(store.query(pageIndex$)).toHaveLength(1);
    expect(store.query(pageContentBySlug$("index"))?.content).toBe("# Hello");
    expect(store.query(pageContentBySlug$("index"))?.contentStatus).toBe("fresh");
  });

  test("marks stale and deleted page bodies during manifest reconciliation", async () => {
    const store = await makeStore();
    const manifest = (pages: Array<{ slug: string; title: string; hash: string }>) =>
      events.manifestApplied({
        siteSlug: "diana",
        scope: "public",
        manifestHash: crypto.randomUUID(),
        generatedAt: "2026-05-09T12:00:00.000Z",
        receivedAt: Date.now(),
        manifestSize: 100,
        compactTreeJson: JSON.stringify(pages.map((page) => ["f", page.slug])),
        pagesJson: JSON.stringify(
          pages.map((page) => ({
            slug: page.slug,
            title: page.title,
            tags: [],
            description: null,
            contentHash: page.hash,
            sensitive: false,
            size: 12,
          })),
        ),
        assetsJson: JSON.stringify([]),
      });

    store.commit(
      manifest([
        { slug: "index", title: "Index", hash: "hash-1" },
        { slug: "old", title: "Old", hash: "old-1" },
      ]),
      events.pageContentFetched({
        slug: "index",
        title: "Index",
        content: "# Hello",
        tags: [],
        contentHash: "hash-1",
        sensitive: false,
        size: 7,
        fetchedAt: 2,
      }),
      events.pageContentFetched({
        slug: "old",
        title: "Old",
        content: "# Old",
        tags: [],
        contentHash: "old-1",
        sensitive: false,
        size: 5,
        fetchedAt: 2,
      }),
      manifest([{ slug: "index", title: "Index", hash: "hash-2" }]),
    );

    expect(store.query(pageContentBySlug$("index"))?.contentStatus).toBe("stale");
    expect(store.query(pageContentBySlug$("index"))?.expectedContentHash).toBe("hash-2");
    expect(store.query(pageContentBySlug$("old"))?.contentStatus).toBe("deleted");
    expect(store.query(stalePageContent$).map((page) => page.slug)).toEqual([
      "index",
      "old",
    ]);
  });

  test("separates missing pages and cache resets", async () => {
    const store = await makeStore();
    store.commit(
      events.pageContentMissing({
        slug: "wiki/missing",
        contentHash: null,
        missingAt: 3,
      }),
    );
    expect(store.query(pageContentBySlug$("wiki/missing"))?.missingAt).toBe(3);

    store.commit(events.cacheResetRequested({ requestedAt: 4 }));
    expect(store.query(pageContentBySlug$("wiki/missing"))).toBeNull();
  });
});
