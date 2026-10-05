// The logged-out education manifest is derived from the cached public snapshot.
// These tests pin it byte-for-byte to the live education path
// (educationDocumentsGateway over the backend), which stays the oracle and the
// fallback. If either side's filter changes, the equivalence test fails.
import { expect, test } from "bun:test";
import { createManifestSnapshotCache, createWikiManifestResponse, type WikiApiContext, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { educationDocumentsGateway, educationManifestSubset, isEducationSlug } from "./education-access";

type Row = { slug: string; title: string; sensitive: boolean };
const rows: Row[] = [
  { slug: "wiki/education/index", title: "Education home", sensitive: false },
  { slug: "wiki/education/oncology-101/index", title: "Oncology 101", sensitive: false },
  { slug: "wiki/education/oncology-101/lesson-1", title: "Lesson 1", sensitive: false },
  { slug: "Wiki/Education/Mixed-Case/Page", title: "Mixed case lesson", sensitive: false },
  { slug: "wiki/education/draft-sensitive", title: "SENSITIVE-EDU-TITLE", sensitive: true },
  { slug: "wiki/education-extra/page", title: "ADJACENT-PREFIX-TITLE", sensitive: false },
  { slug: "wiki/updates/week-13", title: "NONEDU-PUBLIC-TITLE", sensitive: false },
  { slug: "wiki/private/patient-alpha", title: "SENSITIVE-PATIENT-TITLE", sensitive: true },
  { slug: "sources/doc", title: "NONEDU-SOURCE-TITLE", sensitive: false },
  { slug: "index", title: "Home", sensitive: false },
];
type Asset = { path: string; ownerSlugs: string[]; sensitive: boolean };
const assets: Asset[] = [
  { path: "Wiki/Education/Mixed-Case/Slide.pdf", ownerSlugs: ["Wiki/Education/Mixed-Case/Page"], sensitive: false },
  { path: "sources/paper.pdf", ownerSlugs: ["sources/doc"], sensitive: false },
  { path: "wiki/education-extra/adjacent.pdf", ownerSlugs: ["wiki/education-extra/page"], sensitive: false },
  { path: "wiki/education/draft-sensitive.pdf", ownerSlugs: ["wiki/education/draft-sensitive"], sensitive: true },
  { path: "wiki/education/oncology-101/handout.pdf", ownerSlugs: ["wiki/education/oncology-101/lesson-1"], sensitive: false },
  // Shared with a public wiki page: stays public (the shared-images fix).
  { path: "wiki/education/shared-with-update.pdf", ownerSlugs: ["wiki/education/index", "wiki/updates/week-13"], sensitive: false },
  // Shared with a sensitive page: the asset itself is sensitive.
  { path: "wiki/education/shared-with-patient.pdf", ownerSlugs: ["wiki/education/index", "wiki/private/patient-alpha"], sensitive: true },
  { path: "wiki/private/scan.pdf", ownerSlugs: ["wiki/private/patient-alpha"], sensitive: true },
];

function backend(extraAssets: Asset[] = []): WikiApiDocumentsGateway {
  const all = [...assets, ...extraAssets].sort((a, b) => a.path < b.path ? -1 : 1);
  const paged = <T,>(items: T[], cursor: string | null, numItems: number) => {
    const start = Number(cursor ?? 0);
    const end = Math.min(items.length, start + Math.min(numItems, 3));
    return { page: items.slice(start, end), isDone: end >= items.length, continueCursor: end >= items.length ? null : String(end) };
  };
  const visible = (includeSensitive?: boolean) => rows.filter(row => includeSensitive || !row.sensitive);
  return {
    listManifestPage: async ({ cursor, numItems, includeSensitive }) => {
      const result = paged(visible(includeSensitive), cursor, numItems);
      return { ...result, page: result.page.map(row => ({ slug: row.slug, title: row.title, tags: [], description: null,
        contentHash: `hash-${row.slug}`, sensitive: row.sensitive, size: row.title.length })) };
    },
    listPageWithContent: async ({ cursor, numItems, includeSensitive }) => {
      const result = paged(visible(includeSensitive), cursor, numItems);
      return { ...result, page: result.page.map(row => ({ slug: row.slug, title: row.title, content: "x", tags: [], sensitive: row.sensitive })) };
    },
    listPdfAssetVisibilityPage: async ({ cursor, numItems, includeSensitive }) =>
      paged(all.filter(asset => includeSensitive || !asset.sensitive), cursor, numItems),
    listFileAssetVisibilityPage: async () => ({ page: [], isDone: true, continueCursor: null }),
    listPdfAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
    listFileAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
    getBySlug: async ({ slug, includeSensitive }) => {
      const row = rows.find(candidate => candidate.slug === slug);
      return row && (includeSensitive || !row.sensitive)
        ? { slug: row.slug, title: row.title, content: "x", tags: [], sensitive: row.sensitive } : null;
    },
  };
}

const forbidden = new Proxy({}, { get: () => async () => { throw new Error("live backend read"); } }) as WikiApiDocumentsGateway;
const url = (query = "") => `https://reader.test/api/education/manifest${query}`;
const strip = (json: string) => { const value = JSON.parse(json); delete value.generatedAt; return JSON.stringify(value); };

async function publicSnapshot(extraAssets: Asset[] = []) {
  const response = await createWikiManifestResponse(new Request("https://reader.test/api/wiki/manifest"),
    { siteSlug: "diana", documents: backend(extraAssets), getSessionUser: async () => null });
  const json = await response.text();
  return { json, hash: (JSON.parse(json) as { manifestHash: string }).manifestHash };
}

async function liveEducation(query = "", extraAssets: Asset[] = []) {
  return createWikiManifestResponse(new Request(url(query)),
    { siteSlug: "diana", documents: educationDocumentsGateway(backend(extraAssets)), getSessionUser: async () => null });
}

async function derivedEducation(snapshot: { json: string; hash: string }, init: RequestInit & { query?: string } = {}, subset = educationManifestSubset) {
  let reads = 0;
  const context: WikiApiContext = { siteSlug: "diana", documents: forbidden, getSessionUser: async () => null, publicSubset: subset,
    manifestSnapshotCache: createManifestSnapshotCache(),
    getManifestSnapshot: async () => ({ hash: snapshot.hash, revision: 1, read: async () => { reads++; return snapshot.json; } }) };
  const fetchWith = (next: RequestInit & { query?: string } = init) => createWikiManifestResponse(new Request(url(next.query), next), context);
  return { context, reads: () => reads, fetch: fetchWith, response: await fetchWith() };
}

test("derived education manifest is byte-identical to the live education path", async () => {
  const snapshot = await publicSnapshot();
  for (const query of ["", "?format=compact-v1"]) {
    const live = await liveEducation(query);
    const derived = (await derivedEducation(snapshot, { query })).response;
    expect(derived.headers.get("x-wiki-manifest-source")).toBe("snapshot-education");
    const liveJson = await live.text(), derivedJson = await derived.text();
    expect(strip(derivedJson)).toBe(strip(liveJson));
    expect(derived.headers.get("etag")).toBe(live.headers.get("etag"));
    for (const header of ["cache-control", "cdn-cache-control", "vary", "x-wiki-cache-scope", "content-type"]) {
      expect(derived.headers.get(header)).toBe(live.headers.get(header));
    }
  }
  const body = JSON.parse(await (await liveEducation()).text());
  // The fixture exercises every category the filter has to get right.
  expect(body.pages.map((page: { slug: string }) => page.slug)).toEqual([
    "Wiki/Education/Mixed-Case/Page", "wiki/education/index", "wiki/education/oncology-101/index", "wiki/education/oncology-101/lesson-1"]);
  expect(body.assets.map((asset: { path: string }) => asset.path)).toEqual([
    "Wiki/Education/Mixed-Case/Slide.pdf", "wiki/education/oncology-101/handout.pdf", "wiki/education/shared-with-update.pdf"]);
});

test("derived education manifest exposes nothing outside the public curriculum", async () => {
  const text = await (await derivedEducation(await publicSnapshot())).response.text();
  for (const secret of ["SENSITIVE", "NONEDU", "ADJACENT", "patient", "private", "sources/", "week-13", "education-extra", "draft-sensitive", "paper.pdf", "scan.pdf"]) {
    expect(text).not.toContain(secret);
  }
  const manifest = JSON.parse(text);
  expect(manifest.scope).toBe("public");
  for (const slug of [...manifest.pages.map((page: { slug: string }) => page.slug), ...manifest.assets.map((asset: { path: string }) => asset.path)]) {
    expect(isEducationSlug(slug)).toBe(true);
  }
  expect(manifest.pages.every((page: { sensitive: boolean }) => page.sensitive === false)).toBe(true);
});

test("the equivalence check fails when the subset filter diverges", async () => {
  const snapshot = await publicSnapshot();
  const live = strip(await (await liveEducation()).text());
  const widened = [
    { ...educationManifestSubset, includePage: () => true },
    { ...educationManifestSubset, includeAsset: () => true },
    { ...educationManifestSubset, includePage: (page: { slug: string }) => page.slug.toLowerCase().startsWith("wiki/education") },
    { ...educationManifestSubset, includePage: (page: { slug: string }) => !page.slug.startsWith("Wiki") && educationManifestSubset.includePage(page) },
  ];
  for (const subset of widened) {
    const derived = (await derivedEducation(snapshot, {}, subset)).response;
    expect(strip(await derived.text())).not.toBe(live);
  }
});

test("repeat and conditional requests reuse the derived result without storage reads", async () => {
  const snapshot = await publicSnapshot();
  const { fetch, reads, response } = await derivedEducation(snapshot);
  const etag = response.headers.get("etag")!;
  expect(reads()).toBe(1);
  const gzip = { headers: { "Accept-Encoding": "gzip" }, query: "?format=compact-v1" };
  const first = await fetch(gzip);
  expect(first.headers.get("content-encoding")).toBe("gzip");
  const second = await fetch(gzip);
  expect(second.headers.get("x-wiki-manifest-source")).toBe("snapshot-education-cached");
  expect(Buffer.from(await second.arrayBuffer())).toEqual(Buffer.from(await first.arrayBuffer()));
  for (const validator of [etag, etag.replace("W/", ""), "*"]) {
    const notModified = await fetch({ headers: { "If-None-Match": validator } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(etag);
  }
  expect((await fetch({ headers: { "If-None-Match": 'W/"stale"' } })).status).toBe(200);
  expect(reads()).toBe(1);
});

test("an untrustworthy snapshot falls back to the live education path", async () => {
  const snapshot = await publicSnapshot();
  const tampered = JSON.parse(snapshot.json);
  tampered.pages.push({ ...tampered.pages[0], slug: "wiki/education/injected", title: "INJECTED", sensitive: true });
  for (const json of [JSON.stringify(tampered), snapshot.json.replace("Education home", "Edited"), "not json"]) {
    let live = 0;
    const documents = educationDocumentsGateway(backend());
    const counted = new Proxy(documents, { get: (target, key) => (...args: unknown[]) => { live++; return (target as never as Record<string, (...a: unknown[]) => unknown>)[key as string]!(...args); } });
    const response = await createWikiManifestResponse(new Request(url()), { siteSlug: "diana", documents: counted, getSessionUser: async () => null,
      publicSubset: educationManifestSubset, getManifestSnapshot: async () => ({ hash: snapshot.hash, read: async () => json }) });
    expect(response.headers.get("x-wiki-manifest-source")).toBe("manifest");
    expect(live).toBeGreaterThan(0);
    expect(await response.text()).not.toContain("INJECTED");
  }
  const none = await createWikiManifestResponse(new Request(url()), { siteSlug: "diana", documents: educationDocumentsGateway(backend()),
    getSessionUser: async () => null, publicSubset: educationManifestSubset, getManifestSnapshot: async () => null });
  expect(none.headers.get("x-wiki-manifest-source")).toBe("manifest");
});

test("known limit: asset ownership is not in the snapshot, so an education-path asset owned only by public non-education pages is listed", async () => {
  // The live path hides it (no education owner); the file route still refuses it.
  // The snapshot has no owner data, so the derived list is a superset only here.
  const orphan: Asset = { path: "wiki/education/orphan.pdf", ownerSlugs: ["wiki/updates/week-13"], sensitive: false };
  const live = JSON.parse(await (await liveEducation("", [orphan])).text());
  const derived = JSON.parse(await (await derivedEducation(await publicSnapshot([orphan]))).response.text());
  expect(live.assets.map((asset: { path: string }) => asset.path)).not.toContain(orphan.path);
  expect(derived.assets.map((asset: { path: string }) => asset.path)).toContain(orphan.path);
  expect(derived.pages).toEqual(live.pages);
});
