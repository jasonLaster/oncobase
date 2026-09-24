import { describe, expect, test } from "bun:test";
import {
  createWikiManifestResponse,
  createWikiSessionResponse,
  type WikiApiContext,
} from "./server";

function manifestContext({
  failAssetVisibility = false,
  failFullManifest = false,
} = {}) {
  const manifestPageSizes: number[] = [];
  let pdfCalls = 0;
  let fileCalls = 0;

  const context: WikiApiContext = {
    siteSlug: "diana",
    ...(failFullManifest ? { manifestPrioritySlugs: ["index"] } : {}),
    getSessionUser: async () => null,
    documents: {
      listManifestPage: async ({ numItems }) => {
        if (failFullManifest) throw new Error("fixture full manifest timeout");
        manifestPageSizes.push(numItems);
        return {
          page: [
            {
              slug: "index",
              title: "Index",
              tags: [],
              description: null,
              contentHash: "index-hash",
              sensitive: false,
              size: 7,
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      },
      listPageWithContent: async () => ({
        page: [],
        isDone: true,
        continueCursor: null,
      }),
      listPdfAssetPathsPage: async ({ cursor }) => {
        pdfCalls += 1;
        return cursor === null
          ? {
              page: ["sources/one.pdf"],
              isDone: false,
              continueCursor: "next",
            }
          : {
              page: ["sources/two.pdf"],
              isDone: true,
              continueCursor: null,
            };
      },
      listFileAssetPathsPage: async () => {
        fileCalls += 1;
        return {
          page: ["package.json", "tsconfig.json", "images/scan.jpg"],
          isDone: true,
          continueCursor: null,
        };
      },
      listPdfAssetVisibilityPage: async ({ cursor }) => {
        if (failAssetVisibility) {
          throw new Error("fixture asset visibility query unavailable");
        }
        pdfCalls += 1;
        return cursor === null
          ? {
              page: [
                {
                  path: "sources/one.pdf",
                  ownerSlugs: [],
                  sensitive: false,
                },
              ],
              isDone: false,
              continueCursor: "next",
            }
          : {
              page: [
                {
                  path: "sources/two.pdf",
                  ownerSlugs: [],
                  sensitive: false,
                },
              ],
              isDone: true,
              continueCursor: null,
            };
      },
      listFileAssetVisibilityPage: async () => {
        fileCalls += 1;
        return {
          page: [
            {
              path: "images/scan.jpg",
              ownerSlugs: [],
              sensitive: false,
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      },
      getBySlug: async () => null,
    },
  };

  return {
    context,
    calls: () => ({
      manifestPageSizes,
      pdf: pdfCalls,
      file: fileCalls,
    }),
  };
}

describe("wiki manifest server", () => {
  test("bootstraps navigation PDFs without scanning the bulk file-asset catalog", async () => {
    const { context, calls } = manifestContext();
    const response = await createWikiManifestResponse(
      new Request("https://example.test/api/wiki/manifest?scope=public"),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe(1);
    expect(response.headers.get("cdn-cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    expect(calls()).toEqual({
      manifestPageSizes: [500],
      pdf: 2,
      file: 0,
    });
    expect(body.assets).toEqual([
      {
        kind: "pdf",
        path: "sources/one.pdf",
        contentHash: null,
        size: null,
      },
      {
        kind: "pdf",
        path: "sources/two.pdf",
        contentHash: null,
        size: null,
      },
    ]);
    expect(JSON.stringify(body.compactTree)).toContain("one");
    expect(JSON.stringify(body.compactTree)).not.toContain("package.json");
  });

  test("never caches a bounded partial manifest or its validators", async () => {
    const { context } = manifestContext({ failFullManifest: true });
    const first = await createWikiManifestResponse(
      new Request("https://example.test/api/wiki/manifest?scope=public"),
      context,
    );
    const etag = first.headers.get("etag");
    const body = await first.json();

    expect(first.status).toBe(200);
    expect(first.headers.get("x-wiki-manifest-partial")).toBe("true");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("cdn-cache-control")).toBeNull();
    expect(etag).toBeTruthy();
    expect(body.assets).toEqual([
      {
        kind: "pdf",
        path: "sources/one.pdf",
        contentHash: null,
        size: null,
      },
    ]);
    expect(body.assets[0]).not.toHaveProperty("ownerSlugs");
    expect(body.assets[0]).not.toHaveProperty("sensitive");

    const validated = await createWikiManifestResponse(
      new Request("https://example.test/api/wiki/manifest?scope=public", {
        headers: { "If-None-Match": etag ?? "" },
      }),
      context,
    );
    expect(validated.status).toBe(304);
    expect(validated.headers.get("x-wiki-manifest-partial")).toBe("true");
    expect(validated.headers.get("cache-control")).toBe("no-store");
    expect(validated.headers.get("cdn-cache-control")).toBeNull();
  });

  test("marks the manifest partial when asset ownership metadata is unavailable", async () => {
    const { context } = manifestContext({ failAssetVisibility: true });
    const response = await createWikiManifestResponse(
      new Request("https://example.test/api/wiki/manifest?scope=public"),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-wiki-manifest-partial")).toBe("true");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(body.pages).toHaveLength(1);
    expect(body.assets).toEqual([]);
  });

  test("exposes sensitive asset paths only when every recorded owner is accessible", async () => {
    const { context } = manifestContext();
    context.getSessionUser = async () => ({ _id: "reader" });
    context.access = {
      canUserAccessSlug: async () => false,
      getAllowedSlugs: async () => ["private/allowed"],
      filterAccessibleSlugs: async (_user, slugs) =>
        slugs.map((slug) => ({
          slug,
          allowed: slug === "private/allowed",
          hasDocument: slug !== "private/missing",
        })),
    };
    context.documents.listPdfAssetVisibilityPage = async () => ({
      page: [
        {
          path: "sources/public.pdf",
          ownerSlugs: [],
          sensitive: false,
        },
        {
          path: "private/allowed.pdf",
          ownerSlugs: ["private/allowed"],
          sensitive: true,
        },
        {
          path: "private/shared.pdf",
          ownerSlugs: ["private/allowed", "private/denied"],
          sensitive: true,
        },
        {
          path: "private/orphan.pdf",
          ownerSlugs: [],
          sensitive: true,
        },
        {
          path: "private/missing-owner.pdf",
          ownerSlugs: ["private/missing"],
          sensitive: true,
        },
      ],
      isDone: true,
      continueCursor: null,
    });

    const response = await createWikiManifestResponse(
      new Request("https://example.test/api/wiki/manifest?scope=session"),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assets.map((asset: { path: string }) => asset.path)).toEqual([
      "sources/public.pdf",
      "private/allowed.pdf",
    ]);
    expect(JSON.stringify(body.compactTree)).not.toContain("shared");
    expect(JSON.stringify(body.compactTree)).not.toContain("orphan");
    expect(JSON.stringify(body.compactTree)).not.toContain("missing-owner");
  });
});

test("manifest batches overlap, reuse owner checks, and refresh access for the next request", async () => {
  const { context } = manifestContext();
  context.getSessionUser = async () => ({ _id: "reader" });
  const slugs = Array.from({ length: 850 }, (_, index) => `private/${index}`);
  let calls: string[][] = [];
  let active = 0;
  let peak = 0;
  let allowed = true;
  context.access = {
    canUserAccessSlug: async () => false,
    getAllowedSlugs: async () => [],
    async filterAccessibleSlugs(_user, batch) {
      calls.push(batch);
      peak = Math.max(peak, ++active);
      await Bun.sleep(1);
      active--;
      return batch.map((slug) => ({ slug, allowed, hasDocument: slug !== "private/missing" }));
    },
  };
  context.documents.listManifestPage = async () => ({
    page: slugs.map((slug) => ({ slug, title: slug, tags: [], description: null, contentHash: null, sensitive: true, size: 1 })),
    isDone: true, continueCursor: null,
  });
  context.documents.listPdfAssetVisibilityPage = async () => ({
    page: [
      ...slugs.map((slug) => ({ path: `${slug}.pdf`, ownerSlugs: [slug], sensitive: true })),
      { path: "public.pdf", ownerSlugs: ["public-owner"], sensitive: false },
      { path: "orphan.pdf", ownerSlugs: [], sensitive: true },
      { path: "missing.pdf", ownerSlugs: ["private/missing"], sensitive: true },
    ],
    isDone: true, continueCursor: null,
  });
  const request = () => new Request("https://example.test/api/wiki/manifest?scope=session");
  const first = await (await createWikiManifestResponse(request(), context)).json();
  expect(first.pages).toHaveLength(850);
  expect(first.assets).toHaveLength(851);
  expect(calls.flat()).toHaveLength(851);
  expect(new Set(calls.flat()).size).toBe(851);
  expect(calls.flat()).not.toContain("public-owner");
  expect(calls.every((batch) => batch.length <= 100)).toBe(true);
  expect(peak).toBe(4);
  allowed = false;
  calls = [];
  const second = await (await createWikiManifestResponse(request(), context)).json();
  expect(second.pages).toEqual([]);
  expect(second.assets.map((asset: { path: string }) => asset.path)).toEqual(["public.pdf"]);
  expect(calls.flat()).toHaveLength(851);
  expect(second.manifestHash).not.toBe(first.manifestHash);
});

test("manifest order and hash do not depend on sensitivity index grouping", async () => {
  const { context } = manifestContext();
  const pages = ["a", "z"].map((slug) => ({ slug, title: slug, tags: [], description: null, contentHash: null, sensitive: false, size: 1 }));
  context.documents.listManifestPage = async () => ({ page: pages, isDone: true, continueCursor: null });
  const request = () => new Request("https://example.test/api/wiki/manifest?scope=public");
  const first = await (await createWikiManifestResponse(request(), context)).json();
  context.documents.listManifestPage = async () => ({ page: [...pages].reverse(), isDone: true, continueCursor: null });
  const second = await (await createWikiManifestResponse(request(), context)).json();
  expect(second.manifestHash).toBe(first.manifestHash);
  expect(second.pages).toEqual(first.pages);
});

describe("versioned public manifest snapshots", () => {
  test("serves identical bytes without pagination and validates without reading storage", async () => {
    const { context, calls } = manifestContext();
    const live = await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest"), context);
    const json = await live.text();
    const hash = JSON.parse(json).manifestHash;
    const before = calls();
    let reads = 0;
    context.getManifestSnapshot = async () => ({ hash, read: async () => { reads++; return json; } });
    const fast = await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest"), context);
    expect(await fast.text()).toBe(json);
    expect(fast.headers.get("etag")).toBe(live.headers.get("etag"));
    expect(fast.headers.get("x-wiki-manifest-source")).toBe("snapshot");
    const validated = await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest", { headers: { "if-none-match": `"${hash}"` } }), context);
    expect(validated.status).toBe(304);
    expect(reads).toBe(1);
    expect(calls()).toEqual(before);
  });

  test("storage failures and stale snapshots fall back to live reads", async () => {
    for (const snapshot of [null, { hash: "old", read: async () => { throw new Error("Retired storage"); } }]) {
      const { context, calls } = manifestContext();
      context.getManifestSnapshot = async () => snapshot;
      const result = await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest"), context);
      expect(result.status).toBe(200);
      expect(result.headers.get("x-wiki-manifest-source")).toBe("manifest");
      expect(calls().manifestPageSizes.length).toBeGreaterThan(0);
    }
  });

  test("session requests never consult a shared snapshot; gate headers still override caching", async () => {
    const { context } = manifestContext();
    let calls = 0;
    context.getManifestSnapshot = async () => { calls++; return { hash: "current", read: async () => "{}" }; };
    const denied = await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest?scope=session"), context);
    expect(denied.status).toBe(401);
    context.getSessionUser = async () => ({ _id: "user" });
    await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest?scope=session"), context);
    expect(calls).toBe(0);
    context.decorateHeaders = headers => { const h = new Headers(headers); h.set("Cache-Control", "private, no-store"); h.set("CDN-Cache-Control", "no-store"); return h; };
    const response = await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest", { headers: { "if-none-match": '"current"' } }), context);
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  });
});


describe("wiki session selection", () => {
  const request = (query: string) => new Request(`https://example.test/api/wiki/session?${query}`);

  test("automatic signed-out selection returns public privately after one session lookup", async () => {
    const { context } = manifestContext();
    let reads = 0;
    context.getSessionUser = async () => { reads++; return null; };
    const response = await createWikiSessionResponse(request("scope=session&fallback=public"), context);
    expect(reads).toBe(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scope: "public", authenticated: false, userHash: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-wiki-cache-scope")).toBe("public");
  });

  test("explicit session requests still require sign-in", async () => {
    const { context } = manifestContext();
    expect((await createWikiSessionResponse(request("scope=session"), context)).status).toBe(401);
  });

  test("explicit public selection never looks up the account", async () => {
    const { context } = manifestContext();
    context.getSessionUser = async () => { throw new Error("Unexpected account lookup"); };
    const response = await createWikiSessionResponse(request("scope=public"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  test("automatic signed-in selection retains the access-specific session identity", async () => {
    const { context } = manifestContext();
    context.getSessionUser = async () => ({ _id: "reader" });
    let allowed = ["private/one"];
    context.access = {
      getAllowedSlugs: async () => allowed,
      canUserAccessSlug: async () => true,
      filterAccessibleSlugs: async () => [],
    };
    const automatic = await createWikiSessionResponse(request("scope=session&fallback=public"), context);
    const identity = await automatic.json();
    expect(identity).toEqual(await (await createWikiSessionResponse(request("scope=session"), context)).json());
    expect(identity).toMatchObject({ scope: "session", authenticated: true });
    expect(automatic.headers.get("cache-control")).toBe("private, no-store");
    allowed = [];
    const revoked = await (await createWikiSessionResponse(request("scope=session&fallback=public"), context)).json();
    expect(revoked.cacheKey).not.toBe(identity.cacheKey);
  });

  test("account lookup failures do not select public", async () => {
    const { context } = manifestContext();
    context.getSessionUser = async () => { throw new Error("Session unavailable"); };
    await expect(createWikiSessionResponse(request("scope=session&fallback=public"), context)).rejects.toThrow("Session unavailable");
  });
});

test("indexed manifest trees preserve file/directory collisions and report fixed phases", async () => {
  const { context } = manifestContext();
  const slugs = ["same", "same/child", "nested/item/child", "nested/item", "same", "tree/leaf"];
  context.documents.listManifestPage = async () => ({ page: slugs.map(slug => ({ slug, title: slug, tags: [], description: null, contentHash: "hash", sensitive: false, size: 1 })), isDone: true, continueCursor: null });
  context.documents.listPdfAssetVisibilityPage = async () => ({ page: ["same.pdf", "same/child.pdf", "nested/item.pdf", "tree.pdf"].map(path => ({ path, ownerSlugs: [], sensitive: false })), isDone: true, continueCursor: null });
  const phases: string[] = [];
  context.onManifestPhase = (name, ms) => { phases.push(name); expect(ms).toBeGreaterThanOrEqual(0); };
  const body = await (await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest"), context)).json();
  expect(body.compactTree).toEqual([
    ["d", "nested", [["d", "item", [["f", "child"]]], ["p", "item"]]],
    ["d", "same", [["p", "child"]]], ["d", "tree", [["f", "leaf"], ["p", "tree", "tree.pdf"]]], ["p", "same"],
  ]);
  expect(phases).toEqual(["read", "filter", "tree", "hash", "serialize"]);
  context.onManifestPhase = () => { throw new Error("observer failed"); };
  expect((await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest"), context)).status).toBe(200);
});

test("wide manifest folders retain all pages and PDF paths", async () => {
  const { context } = manifestContext();
  context.documents.listManifestPage = async () => ({ page: Array.from({ length: 7011 }, (_, i) => ({ slug: `wide/page-${i}`, title: "Synthetic", tags: [], description: null, contentHash: "hash", sensitive: false, size: 1 })), isDone: true, continueCursor: null });
  context.documents.listPdfAssetVisibilityPage = async () => ({ page: Array.from({ length: 11000 }, (_, i) => ({ path: `wide/attachment-${i}.pdf`, ownerSlugs: [], sensitive: false })), isDone: true, continueCursor: null });
  const body = await (await createWikiManifestResponse(new Request("https://example.test/api/wiki/manifest"), context)).json();
  expect(body.compactTree).toHaveLength(1);
  expect(body.compactTree[0][2]).toHaveLength(18011);
  expect(body.pages).toHaveLength(7011);
  expect(body.assets).toHaveLength(11000);
});
