import { createHash } from "node:crypto";
import { test, expect } from "bun:test";
import { createWikiManifestResponse, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { patchManifestPages } from "./manifestDelta";

test("incremental public page metadata matches a complete rebuild; unsafe dependencies fall back", async () => {
  const page = (slug: string) => ({ slug, title: slug, tags: [], description: null, contentHash: "old", sensitive: false, size: 1 });
  const pages = [page("home"), page("folder/other")];
  const documents: WikiApiDocumentsGateway = {
    listManifestPage: async () => ({ page: pages, isDone: true, continueCursor: null }),
    listPdfAssetVisibilityPage: async () => ({ page: [{ path: "file.pdf", ownerSlugs: ["home"], sensitive: false }], isDone: true, continueCursor: null }),
    listFileAssetVisibilityPage: async () => ({ page: [], isDone: true, continueCursor: null }),
    listPageWithContent: async () => { throw Error("unexpected fallback"); },
    listPdfAssetPathsPage: async () => { throw Error("unexpected fallback"); },
    listFileAssetPathsPage: async () => { throw Error("unexpected fallback"); },
    getBySlug: async () => null,
  };
  const build = async () => (await createWikiManifestResponse(new Request("https://fixture.test/api/wiki/manifest?scope=public"), { siteSlug: "alpha", documents, getSessionUser: async () => null })).json();
  const base = await build();
  pages[0] = { ...pages[0], title: "New title", contentHash: "new", size: 20 };
  const patched = JSON.parse(patchManifestPages(base, "alpha", base.manifestHash, [pages[0]])!);
  const full = await build();
  expect({ ...patched, generatedAt: "" }).toEqual({ ...full, generatedAt: "" });
  expect(patched.pages.find((page: any) => page.slug === "folder/other")).toEqual(base.pages.find((page: any) => page.slug === "folder/other"));
  expect(patched.assets).toEqual(base.assets);
  expect(patchManifestPages(base, "beta", base.manifestHash, [pages[0]])).toBeNull();
  expect(patchManifestPages(base, "alpha", "wrong", [pages[0]])).toBeNull();
  expect(patchManifestPages(base, "alpha", base.manifestHash, [null])).toBeNull();
  const additions = ["new/deep/page", "home/child", "file", ".hidden/page", "z-last", "a-first"].map(page);
  pages.push(...additions);
  const extended = JSON.parse(patchManifestPages(base, "alpha", base.manifestHash, [pages[0], ...additions])!);
  const rebuilt = await build();
  expect({ ...extended, generatedAt: "" }).toEqual({ ...rebuilt, generatedAt: "" });
  expect(patchManifestPages(base, "alpha", base.manifestHash, [{ ...pages[0], sensitive: true }])).toBeNull();
  expect(patchManifestPages(base, "alpha", base.manifestHash, [pages[0], pages[0]])).toBeNull();
  expect(patchManifestPages({ ...base, pages: [] }, "alpha", base.manifestHash, [pages[0]])).toBeNull();
});

test("stored Convex key order is preserved while validating and patching the manifest", () => {
  const pages = [{ contentHash: "old", description: null, sensitive: false, size: 1, slug: "home", tags: [], title: "Home" }];
  const core = { schemaVersion: 1, siteSlug: "alpha", scope: "public", compactTree: [["f", "home"]], pages, assets: [] };
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
  const base = { ...core, manifestHash: hash(core), generatedAt: "fixture" };
  const changed = { slug: "home", title: "Updated", tags: [], description: null, contentHash: "new", sensitive: false, size: 2 };
  const patched = JSON.parse(patchManifestPages(base, "alpha", base.manifestHash, [changed])!);
  expect(patched.manifestHash).toBe(hash({ ...core, pages: [{ ...pages[0], ...changed }] }));
});


test("additions with Convex wire key ordering and an empty base match a full rebuild", async () => {
  const pages: any[] = [];
  const documents: WikiApiDocumentsGateway = {
    listManifestPage: async () => ({ page: pages, isDone: true, continueCursor: null }),
    listPdfAssetVisibilityPage: async () => ({ page: [], isDone: true, continueCursor: null }),
    listFileAssetVisibilityPage: async () => ({ page: [], isDone: true, continueCursor: null }),
    listPageWithContent: async () => { throw Error("unexpected fallback"); },
    listPdfAssetPathsPage: async () => { throw Error("unexpected fallback"); },
    listFileAssetPathsPage: async () => { throw Error("unexpected fallback"); },
    getBySlug: async () => null,
  };
  const build = async () => (await createWikiManifestResponse(new Request("https://fixture.test/api/wiki/manifest?scope=public"), { siteSlug: "alpha", documents, getSessionUser: async () => null })).json();
  const base = await build();
  pages.push({ contentHash: "new", description: null, sensitive: false, size: 1, slug: "new", tags: [], title: "New" });
  const patched = JSON.parse(patchManifestPages(base, "alpha", base.manifestHash, pages)!);
  expect({ ...patched, generatedAt: "" }).toEqual({ ...await build(), generatedAt: "" });
});
