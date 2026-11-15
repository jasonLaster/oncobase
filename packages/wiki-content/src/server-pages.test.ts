import { expect, test } from "bun:test";
import { cancellableContext, createWikiPagesResponse, withTimeout, type PageWithContent, type WikiApiContext } from "./server";

const docs: Record<string, PageWithContent> = {
  "public": { slug: "public", title: "Public", content: "open", tags: [], contentHash: "p", sensitive: false },
  "folder/index": { slug: "folder/index", title: "Folder", content: "folder", tags: [], contentHash: "f", sensitive: false },
  "private/allowed": { slug: "private/allowed", title: "Allowed", content: "secret-a", tags: [], contentHash: "a", sensitive: true },
  "private/denied": { slug: "private/denied", title: "Denied", content: "secret-d", tags: [], contentHash: "d", sensitive: true },
};

function pagesContext(user: { _id: string } | null) {
  const calls = { getBySlug: [] as Array<{ slug: string; includeSensitive?: boolean }>, canUserAccessSlug: 0, filterAccessibleSlugs: [] as string[][] };
  let inFlight = 0, peak = 0;
  const unused = async () => { throw new Error("unused"); };
  const context: WikiApiContext = {
    siteSlug: "alpha",
    getSessionUser: async () => user,
    documents: {
      listManifestPage: unused, listPageWithContent: unused, listPdfAssetPathsPage: unused,
      listFileAssetPathsPage: unused, listPdfAssetVisibilityPage: unused, listFileAssetVisibilityPage: unused,
      getBySlug: async (args) => {
        calls.getBySlug.push(args);
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        inFlight--;
        const doc = docs[args.slug];
        return doc && (args.includeSensitive || !doc.sensitive) ? doc : null;
      },
    },
    access: {
      canUserAccessSlug: async () => { calls.canUserAccessSlug++; return true; },
      filterAccessibleSlugs: async (_user, slugs) => {
        calls.filterAccessibleSlugs.push(slugs);
        return slugs.map(slug => ({ slug, allowed: slug !== "private/denied", hasDocument: true }));
      },
      getAllowedSlugs: async () => [],
    },
  };
  return { context, calls, peak: () => peak };
}

const request = (query: string) => new Request(`https://alpha.test/api/wiki/pages?${query}`);

test("slug batches read each candidate once and check access in one batch", async () => {
  const { context, calls } = pagesContext({ _id: "reader" });
  const response = await createWikiPagesResponse(
    request("scope=session&slugs=public,folder,private/allowed,private/denied,missing"),
    context,
  );
  const body = await response.json();
  expect(body.pages.map((page: { slug: string }) => page.slug)).toEqual(["public", "folder/index", "private/allowed"]);
  expect(body.unavailable.map((page: { slug: string }) => page.slug)).toEqual(["private/denied"]);
  expect(JSON.stringify(body)).not.toContain("secret-d");
  // public, folder, folder/index, private/allowed, private/denied, missing, missing/index
  expect(calls.getBySlug).toHaveLength(7);
  expect(calls.getBySlug.every(args => args.includeSensitive === true)).toBe(true);
  expect(calls.canUserAccessSlug).toBe(0);
  expect(calls.filterAccessibleSlugs).toEqual([["private/allowed", "private/denied"]]);
});

test("public scope stubs restricted pages without any access RPC", async () => {
  const { context, calls } = pagesContext(null);
  const body = await (await createWikiPagesResponse(request("slugs=public,private/allowed"), context)).json();
  expect(body.pages.map((page: { slug: string }) => page.slug)).toEqual(["public"]);
  expect(body.unavailable.map((page: { slug: string }) => page.slug)).toEqual(["private/allowed"]);
  expect(JSON.stringify(body)).not.toContain("secret-a");
  expect(calls.filterAccessibleSlugs).toHaveLength(0);
  expect(calls.getBySlug).toHaveLength(2);
});

test("large slug batches bound concurrent document reads", async () => {
  const { context, calls, peak } = pagesContext(null);
  const slugs = Array.from({ length: 100 }, (_, index) => `missing-${index}/index`);
  const response = await createWikiPagesResponse(request(`slugs=${slugs.join(",")}`), context);
  expect(response.status).toBe(200);
  expect(calls.getBySlug).toHaveLength(100);
  expect(peak()).toBeLessThanOrEqual(8);
});

test("timed-out paginated work stops issuing reads after the deadline", async () => {
  const { context } = pagesContext(null);
  let reads = 0;
  context.documents.listManifestPage = async ({ cursor }) => {
    reads++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { page: [], isDone: false, continueCursor: `${Number(cursor ?? 0) + 1}` };
  };
  const paginate = async (live: WikiApiContext) => {
    let cursor: string | null = null;
    for (;;) cursor = (await live.documents.listManifestPage({ cursor, numItems: 1 })).continueCursor;
  };
  await expect(withTimeout(signal => paginate(cancellableContext(context, signal)), 30, "fixture")).rejects.toThrow("fixture timed out");
  const atDeadline = reads;
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(reads - atDeadline).toBeLessThanOrEqual(1);
  expect(atDeadline).toBeGreaterThan(0);
});

// P11: content-addressed page reads.
const YEAR = "private, max-age=31536000, immutable";

test("a versioned read of exactly the readable content gets the year-long private cache", async () => {
  const { context } = pagesContext({ _id: "reader" });
  const response = await createWikiPagesResponse(request("scope=session&slugs=private/allowed,folder&v=a,f"), context);
  expect(response.headers.get("Cache-Control")).toBe(YEAR);
  expect(response.headers.get("X-Wiki-Version")).toBe("match");
  expect(response.headers.get("CDN-Cache-Control")).toBeNull();
  expect(response.headers.get("Vary")).toContain("Cookie");
  expect((await response.json()).pages.map((page: { slug: string }) => page.slug)).toEqual(["private/allowed", "folder/index"]);
});

test("an unversioned read keeps today's headers", async () => {
  const { context } = pagesContext({ _id: "reader" });
  const response = await createWikiPagesResponse(request("scope=session&slugs=private/allowed"), context);
  expect(response.headers.get("Cache-Control")).toBe("private, max-age=30, stale-while-revalidate=300");
  expect(response.headers.get("X-Wiki-Version")).toBeNull();
});

for (const [label, query, user] of [
  ["a mismatched hash", "scope=session&slugs=private/allowed&v=old", { _id: "reader" }],
  ["a page the reader may not read", "scope=session&slugs=private/denied&v=d", { _id: "reader" }],
  ["a restricted page on the public scope", "slugs=private/allowed&v=a", null],
  ["a missing page", "scope=session&slugs=missing&v=x", { _id: "reader" }],
  ["fewer hashes than slugs", "scope=session&slugs=public,folder&v=p", { _id: "reader" }],
  ["one stale hash in a batch", "scope=session&slugs=public,folder&v=p,old", { _id: "reader" }],
] as const) {
  test(`${label} is answered as if unversioned`, async () => {
    const { context } = pagesContext(user);
    const response = await createWikiPagesResponse(request(query), context);
    expect(response.headers.get("Cache-Control")).not.toContain("immutable");
    expect(response.headers.get("Cache-Control")).not.toContain("31536000");
    expect(response.headers.get("X-Wiki-Version")).toBe("mismatch");
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("secret-d");
  });
}

test("a matching versioned 304 keeps the versioned headers", async () => {
  const { context } = pagesContext({ _id: "reader" });
  const first = await createWikiPagesResponse(request("scope=session&slugs=private/allowed&v=a"), context);
  const etag = first.headers.get("ETag")!;
  const second = await createWikiPagesResponse(new Request("https://alpha.test/api/wiki/pages?scope=session&slugs=private/allowed&v=a", { headers: { "If-None-Match": etag } }), context);
  expect(second.status).toBe(304);
  expect(second.headers.get("Cache-Control")).toBe(YEAR);
});
