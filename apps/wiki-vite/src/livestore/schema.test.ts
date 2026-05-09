import { afterEach, describe, expect, test } from "bun:test";
import { makeInMemoryAdapter } from "@livestore/adapter-web";
import { createStorePromise } from "@livestore/livestore";
import { events, schema } from "./schema";
import { fileTree$, pageContentBySlug$, pageIndex$, siteState$ } from "./queries";

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
