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

test("asset upserts match a complete rebuild: hashes, additions, unlisted files and newly sensitive assets", async () => {
  const pages = [{ slug: "home", title: "home", tags: [], description: null, contentHash: "h", sensitive: false, size: 1 }];
  type Row = { path: string; ownerSlugs: string[]; sensitive: boolean; contentHash: string | null };
  const pdfs: Row[] = [{ path: "b.pdf", ownerSlugs: ["home"], sensitive: false, contentHash: "p1" }, { path: "secret.pdf", ownerSlugs: [], sensitive: true, contentHash: "s" }];
  const files: Row[] = [{ path: "img/b.png", ownerSlugs: ["home"], sensitive: false, contentHash: "f1" }];
  const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.path < b.path ? -1 : 1);
  const documents: WikiApiDocumentsGateway = {
    listManifestPage: async () => ({ page: pages, isDone: true, continueCursor: null }),
    // The public builder skips sensitive rows before listing them, as Convex does.
    listPdfAssetVisibilityPage: async () => ({ page: sorted(pdfs).filter(row => !row.sensitive), isDone: true, continueCursor: null }),
    listFileAssetVisibilityPage: async () => ({ page: sorted(files).filter(row => !row.sensitive), isDone: true, continueCursor: null }),
    listPageWithContent: async () => { throw Error("unexpected fallback"); },
    listPdfAssetPathsPage: async () => { throw Error("unexpected fallback"); },
    listFileAssetPathsPage: async () => { throw Error("unexpected fallback"); },
    getBySlug: async () => null,
  };
  const build = async () => (await createWikiManifestResponse(new Request("https://fixture.test/api/wiki/manifest?scope=public"),
    { siteSlug: "alpha", documents, manifestFileAssets: true, getSessionUser: async () => null })).json();
  const base = await build();
  const upsert = (kind: "pdf" | "file", row: Row) => {
    const rows = kind === "pdf" ? pdfs : files;
    const index = rows.findIndex(existing => existing.path === row.path);
    if (index >= 0) rows[index] = row; else rows.push(row);
    return { kind, path: row.path, listed: !row.sensitive, contentHash: row.contentHash };
  };
  const updates = [
    upsert("pdf", { path: "b.pdf", ownerSlugs: ["home"], sensitive: false, contentHash: "p2" }), // hash change
    upsert("pdf", { path: "a.pdf", ownerSlugs: ["home"], sensitive: false, contentHash: "pa" }), // new, sorts first
    upsert("pdf", { path: "c.pdf", ownerSlugs: ["home"], sensitive: false, contentHash: "pc" }), // new, last PDF
    upsert("file", { path: "img/a.png", ownerSlugs: ["home"], sensitive: false, contentHash: "fa" }),
    upsert("file", { path: "data.csv", ownerSlugs: ["home"], sensitive: false, contentHash: "csv" }), // never listed
    upsert("file", { path: "img/b.png", ownerSlugs: [], sensitive: true, contentHash: "f2" }), // now sensitive
    upsert("pdf", { path: "secret.pdf", ownerSlugs: [], sensitive: true, contentHash: "s2" }), // stays hidden
  ];
  const patched = JSON.parse(patchManifestPages(base, "alpha", base.manifestHash, [], updates)!);
  const full = await build();
  expect({ ...patched, generatedAt: "" }).toEqual({ ...full, generatedAt: "" });
  expect(patched.compactTree).not.toEqual(base.compactTree);
  // A PDF hash change alone keeps the tree.
  const rehashed = JSON.parse(patchManifestPages(full, "alpha", full.manifestHash, [], [upsert("pdf", { path: "a.pdf", ownerSlugs: ["home"], sensitive: false, contentHash: "pa2" })])!);
  expect({ ...rehashed, generatedAt: "" }).toEqual({ ...await build(), generatedAt: "" });
  expect(rehashed.compactTree).toEqual(full.compactTree);
  // A PDF that becomes sensitive leaves the tree.
  const hidden = JSON.parse(patchManifestPages(rehashed, "alpha", rehashed.manifestHash, [], [upsert("pdf", { path: "c.pdf", ownerSlugs: [], sensitive: true, contentHash: "pc" })])!);
  expect({ ...hidden, generatedAt: "" }).toEqual({ ...await build(), generatedAt: "" });
});
