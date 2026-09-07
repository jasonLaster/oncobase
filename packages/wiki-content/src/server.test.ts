import { describe, expect, test } from "bun:test";
import {
  createWikiManifestResponse,
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
