import { expect, test } from "bun:test";
import { createWikiPagesResponse, type PageWithContent, type WikiApiContext } from "./server";

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
