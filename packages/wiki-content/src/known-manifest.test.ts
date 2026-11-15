// P6: `?known=<token>` and `?have=<manifestHash>` on /api/wiki/manifest.
import { describe, expect, test } from "bun:test";
import { createWikiContentClient, type WikiManifestPage } from "./index";
import {
  createManifestSnapshotCache,
  createWikiManifestResponse,
  sessionKnownToken,
  type WikiApiContext,
  type WikiManifestState,
} from "./server";

const page = (slug: string, sensitive = false): WikiManifestPage => ({
  slug, title: slug, tags: [], description: null, contentHash: `${slug}-hash`, sensitive, size: 4,
});

async function fixture({ extraPages = 0 } = {}) {
  const publicPages = [page("index"), page("wiki/a"), ...Array.from({ length: extraPages }, (_, i) => page(`wiki/extra-${i}`))];
  const secret = page("private/plan", true);
  const assets = [
    { path: "private/plan.pdf", ownerSlugs: ["private/plan"], sensitive: true },
    { path: "sources/one.pdf", ownerSlugs: [], sensitive: false },
  ];
  const counts = { live: 0, overlay: 0, state: 0, legacyOverlay: 0 };
  let allowed = true;
  let users = new Set(["reader"]);
  const context: WikiApiContext = {
    siteSlug: "diana",
    getSessionUser: async (request) => {
      const user = request.headers.get("x-user");
      return user && users.has(user) ? { _id: user } : null;
    },
    documents: {
      listManifestPage: async ({ includeSensitive }) => {
        counts.live++;
        return { page: includeSensitive ? [...publicPages, secret] : publicPages, isDone: true, continueCursor: null };
      },
      listPageWithContent: async () => ({ page: [], isDone: true, continueCursor: null }),
      listPdfAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      listFileAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      listPdfAssetVisibilityPage: async ({ includeSensitive }) => ({
        page: assets.filter(asset => includeSensitive || !asset.sensitive), isDone: true, continueCursor: null }),
      listFileAssetVisibilityPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      getBySlug: async () => null,
    },
  };
  // The public snapshot is what the builder would produce.
  const publicJson = await (await createWikiManifestResponse(new Request("https://test/api/wiki/manifest"), context)).text();
  const base = JSON.parse(publicJson) as { manifestHash: string };
  const fence: WikiManifestState = { manifestRevision: 1, accessRevision: 1, policyVersion: 1, snapshotHash: base.manifestHash, publishing: false };
  let movingFence = false;
  context.access = {
    canUserAccessSlug: async () => allowed,
    filterAccessibleSlugs: async (_user, slugs) => slugs.map(slug => ({ slug, allowed, hasDocument: true })),
    getAllowedSlugs: async () => allowed ? [secret.slug] : [],
    listAllowedManifestPage: async () => { counts.legacyOverlay++; return { page: allowed ? [secret] : [], isDone: true, continueCursor: null }; },
    getManifestState: async () => { counts.state++; return { ...fence }; },
    listSessionManifestOverlay: async (_user, args) => {
      counts.overlay++;
      // Two pages of private rows, so a fence that moves between them is seen.
      const firstPage = args.pages === null;
      const result = {
        fence: { ...fence },
        snapshot: args.includeSnapshot && fence.snapshotHash ? { hash: fence.snapshotHash, read: async () => publicJson } : null,
        pages: firstPage || args.pages === undefined ? [] : allowed ? [secret] : [],
        pagesDone: !firstPage,
        pagesCursor: firstPage ? "more" : null,
        assets: args.assets === null ? assets.filter(asset => !asset.sensitive || allowed).map(asset => asset.path) : [],
        assetsDone: true,
        assetsCursor: null,
      };
      if (movingFence && !firstPage) result.fence.accessRevision++;
      return result;
    },
  };
  context.getManifestSnapshot = async () => ({ hash: base.manifestHash, revision: fence.manifestRevision, read: async () => publicJson });
  context.manifestSnapshotCache = createManifestSnapshotCache();
  const request = (query = "", user = "reader") => new Request(`https://test/api/wiki/manifest?scope=session${query}`, { headers: { "x-user": user } });
  return {
    context, counts, fence, base, request,
    allow: (value: boolean) => { allowed = value; },
    moveFence: (value: boolean) => { movingFence = value; },
    setUsers: (next: string[]) => { users = new Set(next); },
  };
}

describe("known manifest checks", () => {
  test("the one-transaction overlay serves the same manifest as the live oracle and issues a token", async () => {
    const f = await fixture();
    const { listSessionManifestOverlay, ...legacyAccess } = f.context.access!;
    const oracle = await (await createWikiManifestResponse(f.request(), { ...f.context, access: legacyAccess, getManifestSnapshot: undefined })).json();
    f.counts.live = 0;
    const response = await createWikiManifestResponse(f.request(), f.context);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Wiki-Manifest-Source")).toBe("snapshot-overlay");
    const body = await response.json();
    expect(body.manifestHash).toBe(oracle.manifestHash);
    expect(body.assets.map((asset: { path: string }) => asset.path)).toEqual(["private/plan.pdf", "sources/one.pdf"]);
    expect(response.headers.get("X-Wiki-Known")).toMatch(/^[a-f0-9]{40}$/);
    expect(f.counts.live).toBe(0);
    expect(f.counts.legacyOverlay).toBe(0);
    expect(listSessionManifestOverlay).toBeDefined();
  });

  test("a matching token answers 204 before any manifest read", async () => {
    const f = await fixture();
    const token = (await createWikiManifestResponse(f.request(), f.context)).headers.get("X-Wiki-Known")!;
    const before = { ...f.counts };
    const unchanged = await createWikiManifestResponse(f.request(`&known=${token}`), f.context);
    expect(unchanged.status).toBe(204);
    expect(unchanged.headers.get("Cache-Control")).toBe("private, no-store");
    expect(unchanged.headers.get("X-Wiki-Known")).toBe(token);
    expect(await unchanged.text()).toBe("");
    expect(f.counts).toEqual({ ...before, state: before.state + 1 });
  });

  test("an access change answers the new manifest and a new token", async () => {
    const f = await fixture();
    const first = await createWikiManifestResponse(f.request(), f.context);
    const token = first.headers.get("X-Wiki-Known")!;
    const firstHash = (await first.json()).manifestHash;
    f.allow(false);
    f.fence.accessRevision++;
    const changed = await createWikiManifestResponse(f.request(`&known=${token}`), f.context);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("X-Wiki-Known-Result")).toBe("mismatch");
    expect(changed.headers.get("X-Wiki-Known")).not.toBe(token);
    const body = await changed.json();
    expect(body.manifestHash).not.toBe(firstHash);
    expect(body.pages.map((p: { slug: string }) => p.slug)).not.toContain("private/plan");
    expect(body.assets.map((a: { path: string }) => a.path)).toEqual(["sources/one.pdf"]);
  });

  test("a token is bound to its user and to a signed-in session", async () => {
    const f = await fixture();
    f.setUsers(["reader", "other"]);
    const token = (await createWikiManifestResponse(f.request(), f.context)).headers.get("X-Wiki-Known")!;
    expect((await createWikiManifestResponse(f.request(`&known=${token}`, "other"), f.context)).status).toBe(200);
    f.setUsers([]);
    expect((await createWikiManifestResponse(f.request(`&known=${token}`), f.context)).status).toBe(401);
  });

  test("while a publisher holds the site no token is honored or issued", async () => {
    const f = await fixture();
    const token = (await createWikiManifestResponse(f.request(), f.context)).headers.get("X-Wiki-Known")!;
    f.fence.publishing = true;
    const response = await createWikiManifestResponse(f.request(`&known=${token}`), f.context);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Wiki-Known")).toBeNull();
  });

  test("a fence that moves between overlay pages falls back and issues no token", async () => {
    const f = await fixture();
    f.moveFence(true);
    const response = await createWikiManifestResponse(f.request(), f.context);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Wiki-Known")).toBeNull();
    expect(f.counts.legacyOverlay).toBe(1);
  });

  test("an older backend without the fence queries keeps the old path", async () => {
    const f = await fixture();
    f.context.access!.getManifestState = async () => null;
    f.context.access!.listSessionManifestOverlay = async () => null;
    const response = await createWikiManifestResponse(f.request("&known=anything"), f.context);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Wiki-Known")).toBeNull();
    expect(response.headers.get("X-Wiki-Known-Result")).toBe("unavailable");
  });

  test("have=<manifestHash> answers 204 with a token instead of the body", async () => {
    const f = await fixture();
    const first = await createWikiManifestResponse(f.request(), f.context);
    const hash = (await first.json()).manifestHash;
    const response = await createWikiManifestResponse(f.request(`&have=${hash}`), f.context);
    expect(response.status).toBe(204);
    expect(response.headers.get("X-Wiki-Known-Result")).toBe("have-match");
    expect(response.headers.get("X-Wiki-Known")).toBe(first.headers.get("X-Wiki-Known"));
    expect((await createWikiManifestResponse(f.request("&have=stale"), f.context)).status).toBe(200);
  });

  test("public manifests: snapshot-hash tokens, 204 on match, new body on a new snapshot", async () => {
    const f = await fixture();
    const publicRequest = (query = "") => new Request(`https://test/api/wiki/manifest?format=compact-v1${query}`);
    const first = await createWikiManifestResponse(publicRequest(), f.context);
    const token = first.headers.get("X-Wiki-Known")!;
    expect(token).toMatch(/^[a-f0-9]{40}$/);
    const unchanged = await createWikiManifestResponse(publicRequest(`&known=${token}`), f.context);
    expect(unchanged.status).toBe(204);
    expect(unchanged.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await createWikiManifestResponse(publicRequest(`&have=${f.base.manifestHash}`), f.context)).status).toBe(204);
    const json = JSON.stringify({ ...JSON.parse(await (await createWikiManifestResponse(new Request("https://test/api/wiki/manifest"), f.context)).text()) });
    f.context.getManifestSnapshot = async () => ({ hash: "next-snapshot", revision: 2, read: async () => json });
    const changed = await createWikiManifestResponse(publicRequest(`&known=${token}`), f.context);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("X-Wiki-Known")).not.toBe(token);
  });

  test("an education subset token differs from the full public token", async () => {
    const f = await fixture();
    const full = (await createWikiManifestResponse(new Request("https://test/api/wiki/manifest"), f.context)).headers.get("X-Wiki-Known")!;
    const subset = { ...f.context, publicSubset: { name: "education", includePage: () => true, includeAsset: () => true } };
    const response = await createWikiManifestResponse(new Request(`https://test/api/wiki/manifest?known=${full}`), subset);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Wiki-Known")).not.toBe(full);
  });
});

test("the session token changes with every fence field and the user, and is refused while publishing", () => {
  const fence: WikiManifestState = { manifestRevision: 1, accessRevision: 1, policyVersion: 1, snapshotHash: "s", publishing: false };
  const token = sessionKnownToken("diana", "u", fence)!;
  for (const changed of [{ manifestRevision: 2 }, { accessRevision: 2 }, { policyVersion: 2 }, { snapshotHash: "t" }]) {
    expect(sessionKnownToken("diana", "u", { ...fence, ...changed })).not.toBe(token);
  }
  expect(sessionKnownToken("diana", "v", fence)).not.toBe(token);
  expect(sessionKnownToken("other", "u", fence)).not.toBe(token);
  expect(sessionKnownToken("diana", "u", { ...fence, publishing: true })).toBeNull();
  expect(sessionKnownToken("diana", "u", { ...fence, snapshotHash: null })).toBeNull();
});

describe("client known checks", () => {
  test("validateManifest sends known and have, and treats 204 as unchanged", async () => {
    const urls: string[] = [];
    const manifest = await (async () => {
      const f = await fixture();
      return JSON.parse(await (await createWikiManifestResponse(new Request("https://test/api/wiki/manifest"), f.context)).text());
    })();
    let reply: () => Response = () => new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json", "X-Wiki-Known": "token-1" } });
    const client = createWikiContentClient({ baseUrl: "https://client.test", scope: "session", fetch: (async (url: string) => { urls.push(url); return reply(); }) as typeof fetch });
    const first = await client.validateManifest(undefined);
    expect(first.status).toBe("modified");
    expect(urls[0]).not.toContain("known=");
    reply = () => new Response(null, { status: 204, headers: { "X-Wiki-Known": "token-2" } });
    expect(await client.validateManifest(manifest.manifestHash)).toEqual({ status: "unchanged", partial: false });
    expect(urls[1]).toContain("known=token-1");
    expect(urls[1]).toContain(`have=${manifest.manifestHash}`);
    await client.validateManifest(manifest.manifestHash);
    expect(urls[2]).toContain("known=token-2");
    // A 204 is only meaningful when the client named the manifest it holds.
    await expect(client.validateManifest(undefined)).rejects.toThrow("204");
  });
});
