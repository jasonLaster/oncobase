// P11 for assets: manifests carry stored asset hashes so markdown images and
// PDF links can use content-addressed `/api/file?...&v=<hash>` URLs.
import { describe, expect, test } from "bun:test";
import { isListedManifestAsset, isManifestFileAssetPath, type WikiManifest, type WikiManifestPage } from "./index";
import {
  createManifestSnapshotCache,
  createWikiManifestResponse,
  type AssetVisibilityRecord,
  type WikiApiContext,
  type WikiSessionOverlayPage,
} from "./server";

const page = (slug: string, sensitive = false): WikiManifestPage => ({
  slug, title: slug, tags: [], description: null, contentHash: `${slug}-hash`, sensitive, size: 4,
});

type Row = AssetVisibilityRecord & { contentHash: string | null };

function fixture() {
  const pdfs: Row[] = [
    { path: "private/plan.pdf", ownerSlugs: ["private/plan"], sensitive: true, contentHash: "plan-pdf-1" },
    { path: "sources/one.pdf", ownerSlugs: [], sensitive: false, contentHash: "one-pdf-1" },
  ];
  const files: Row[] = [
    { path: "wiki/images/chart.png", ownerSlugs: [], sensitive: false, contentHash: "chart-1" },
    { path: "wiki/images/legacy.jpg", ownerSlugs: [], sensitive: false, contentHash: null },
    { path: "wiki/data/table.csv", ownerSlugs: [], sensitive: false, contentHash: "csv-1" },
    { path: "private/scan.png", ownerSlugs: ["private/plan"], sensitive: true, contentHash: "scan-1" },
    { path: "private/notes.txt", ownerSlugs: ["private/plan"], sensitive: true, contentHash: "notes-1" },
  ];
  const calls = { file: 0 };
  const visible = (rows: Row[], includeSensitive?: boolean) =>
    ({ page: rows.filter(row => includeSensitive || !row.sensitive).map(row => ({ ...row })), isDone: true, continueCursor: null });
  const context: WikiApiContext = {
    siteSlug: "diana",
    getSessionUser: async (request) => request.headers.get("x-user") ? { _id: "reader" } : null,
    documents: {
      listManifestPage: async ({ includeSensitive }) =>
        ({ page: includeSensitive ? [page("index"), page("private/plan", true)] : [page("index")], isDone: true, continueCursor: null }),
      listPageWithContent: async () => ({ page: [], isDone: true, continueCursor: null }),
      listPdfAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      listFileAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      listPdfAssetVisibilityPage: async ({ includeSensitive }) => visible(pdfs, includeSensitive),
      listFileAssetVisibilityPage: async ({ includeSensitive }) => { calls.file++; return visible(files, includeSensitive); },
      getBySlug: async () => null,
    },
  };
  const build = async () => (await (await createWikiManifestResponse(
    new Request("https://manifest.internal/api/wiki/manifest?scope=public"),
    { ...context, manifestFileAssets: true },
  )).json()) as WikiManifest;
  return { context, pdfs, files, calls, build };
}

const hashes = (manifest: WikiManifest) => Object.fromEntries(manifest.assets.map(asset => [`${asset.kind}:${asset.path}`, asset.contentHash]));

describe("asset hashes in the manifest", () => {
  test("the snapshot builder lists PDFs and public images with their stored hashes", async () => {
    const f = fixture();
    const manifest = await f.build();
    expect(hashes(manifest)).toEqual({
      "pdf:sources/one.pdf": "one-pdf-1",
      "file:wiki/images/chart.png": "chart-1",
      "file:wiki/images/legacy.jpg": null,
    });
    // Images are for versioned URLs only: the file tree still shows PDFs.
    const tree = JSON.stringify(manifest.compactTree);
    expect(tree).toContain("one");
    expect(tree).not.toContain("chart");
  });

  test("live manifests do not scan the file catalog", async () => {
    const f = fixture();
    const live = (await (await createWikiManifestResponse(new Request("https://test/api/wiki/manifest?scope=public"), f.context)).json()) as WikiManifest;
    expect(f.calls.file).toBe(0);
    expect(hashes(live)).toEqual({ "pdf:sources/one.pdf": "one-pdf-1" });
  });

  test("republishing a changed image changes its hash and the manifest hash", async () => {
    const f = fixture();
    const before = await f.build();
    f.files[0]!.contentHash = "chart-2";
    const after = await f.build();
    expect(hashes(after)["file:wiki/images/chart.png"]).toBe("chart-2");
    expect(after.manifestHash).not.toBe(before.manifestHash);
  });

  test("a backend without hashes keeps assets listed with null hashes", async () => {
    const f = fixture();
    for (const row of [...f.pdfs, ...f.files]) delete (row as Partial<Row>).contentHash;
    const manifest = await f.build();
    expect(manifest.assets.every(asset => asset.contentHash === null)).toBe(true);
    expect(manifest.assets.map(asset => asset.path)).toContain("sources/one.pdf");
  });
});

describe("asset hashes in the signed-in overlay", () => {
  async function overlayFixture(options: { files: boolean; onOverlay?: WikiApiContext["onManifestOverlay"] }) {
    const f = fixture();
    const snapshot = await f.build();
    const json = JSON.stringify(snapshot);
    const fence = { manifestRevision: 1, accessRevision: 1, policyVersion: 1, snapshotHash: snapshot.manifestHash, publishing: false };
    const requests: Array<Record<string, unknown>> = [];
    f.context.access = {
      canUserAccessSlug: async () => true,
      filterAccessibleSlugs: async (_user, slugs) => slugs.map(slug => ({ slug, allowed: true, hasDocument: true })),
      getAllowedSlugs: async () => ["private/plan"],
      getManifestState: async () => ({ ...fence }),
      listSessionManifestOverlay: async (_user, args) => {
        requests.push({ ...args });
        const result: WikiSessionOverlayPage = {
          fence: { ...fence },
          snapshot: args.includeSnapshot ? { hash: snapshot.manifestHash, read: async () => json } : null,
          pages: args.pages === null ? [page("private/plan", true)] : [],
          pagesDone: true, pagesCursor: null,
          assets: args.assets === null ? f.pdfs.map(row => row.path) : [],
          assetHashes: args.assets === null ? f.pdfs.map(row => row.contentHash) : [],
          assetsDone: true, assetsCursor: null,
          scan: {
            pages: { read: 2, deleted: 0, denied: 1, kept: 1 },
            assets: { read: 3, deleted: 1, denied: 0, kept: 2 },
            files: { read: 4, deleted: 2, denied: 1, kept: 1 },
          },
        };
        if (options.files) {
          // Two pages of sensitive files, so the files cursor is followed.
          const sensitive = f.files.filter(row => row.sensitive);
          const firstPage = args.files === null;
          const rows = firstPage ? sensitive.slice(0, 1) : args.files === "more" ? sensitive.slice(1) : [];
          Object.assign(result, {
            files: rows.map(row => row.path), fileHashes: rows.map(row => row.contentHash),
            filesDone: !firstPage, filesCursor: firstPage ? "more" : null,
          });
        }
        return result;
      },
    };
    f.context.getManifestSnapshot = async () => ({ hash: snapshot.manifestHash, revision: 1, read: async () => json });
    f.context.manifestSnapshotCache = createManifestSnapshotCache();
    f.context.onManifestOverlay = options.onOverlay;
    const response = await createWikiManifestResponse(
      new Request("https://test/api/wiki/manifest?scope=session", { headers: { "x-user": "reader" } }), f.context);
    expect(response.headers.get("X-Wiki-Manifest-Source")).toBe("snapshot-overlay");
    return { manifest: (await response.json()) as WikiManifest, requests };
  }

  test("PDF hashes, public images from the base and the user's sensitive images", async () => {
    const { manifest, requests } = await overlayFixture({ files: true });
    expect(hashes(manifest)).toEqual({
      "pdf:private/plan.pdf": "plan-pdf-1",
      "pdf:sources/one.pdf": "one-pdf-1",
      "file:wiki/images/chart.png": "chart-1",
      "file:wiki/images/legacy.jpg": null,
      "file:private/scan.png": "scan-1",
    });
    expect(requests.map(args => args.files)).toEqual([null, "more"]);
  });

  test("the overlay's per-call scan counts are summed and reported once", async () => {
    const reports: unknown[] = [];
    await overlayFixture({ files: true, onOverlay: stats => reports.push(stats) });
    expect(reports).toEqual([{
      calls: 2,
      pages: { read: 4, deleted: 0, denied: 2, kept: 2 },
      assets: { read: 6, deleted: 2, denied: 0, kept: 4 },
      files: { read: 8, deleted: 4, denied: 2, kept: 2 },
    }]);
  });

  test("a backend that predates the files list still serves PDFs (with hashes when given)", async () => {
    const { manifest } = await overlayFixture({ files: false });
    expect(hashes(manifest)).toEqual({ "pdf:private/plan.pdf": "plan-pdf-1", "pdf:sources/one.pdf": "one-pdf-1" });
  });
});

test("only PDFs are browsable; only images are listed among file assets", () => {
  expect(isListedManifestAsset({ kind: "pdf", path: "a.pdf" })).toBe(true);
  expect(isListedManifestAsset({ kind: "file", path: "a.png" })).toBe(false);
  for (const path of ["a.png", "b/c.JPG", "d.jpeg", "e.webp", "f.svg", "g.gif", "h.avif"]) expect(isManifestFileAssetPath(path)).toBe(true);
  for (const path of ["a.csv", "b.json", "c.txt", "d.pdf", "png"]) expect(isManifestFileAssetPath(path)).toBe(false);
});
