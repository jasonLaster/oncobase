import { describe, expect, test } from "bun:test";
import {
  createWikiManifestResponse,
  type WikiApiContext,
} from "./server";

function manifestContext({ failFullManifest = false } = {}) {
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

    expect(first.status).toBe(200);
    expect(first.headers.get("x-wiki-manifest-partial")).toBe("true");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("cdn-cache-control")).toBeNull();
    expect(etag).toBeTruthy();

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
});
