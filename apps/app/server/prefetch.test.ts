import { expect, test } from "bun:test";
import type { WikiApiContext } from "@oncobase/wiki-content/server";
import { handlePrefetchRequest } from "./prefetch";

function fixture(signedIn = false) {
  const visits: string[] = [];
  const context = {
    siteSlug: "example",
    getSessionUser: async () => signedIn ? { _id: "reader" } : null,
    documents: { getBySlug: async ({ slug }: { slug: string }) => slug === "gone" ? null : ({ slug, sensitive: slug !== "public" }) },
    access: { canUserAccessSlug: async (_user: unknown, slug: string) => slug === "allowed", filterAccessibleSlugs: async (_user: unknown, slugs: string[]) => slugs.map(slug => ({ slug, allowed: slug === "allowed", hasDocument: true })) },
  } as unknown as WikiApiContext;
  const gateway = { priorities: async () => [{ slug: "denied", sensitive: true }, { slug: "public", sensitive: false }, { slug: "allowed", sensitive: true }], recordVisit: async (slug: string) => { visits.push(slug); } };
  const request = (scope = "public", slug?: string, origin = "https://example.test") => new Request(`https://example.test/api/wiki/prefetch?scope=${scope}`, slug ? { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ slug }) } : {});
  return { context, gateway, visits, request };
}

test("rankings expose only accessible slugs, no counts or browsing history", async () => {
  const f = fixture(true);
  const publicResponse = await handlePrefetchRequest(f.request(), f.context, f.gateway);
  expect(await publicResponse.json()).toEqual({ enabled: true, slugs: ["public"] });
  expect(publicResponse.headers.get("cache-control")).toBe("private, no-store");
  expect(await (await handlePrefetchRequest(f.request("session"), f.context, f.gateway)).json()).toEqual({ enabled: true, slugs: ["public", "allowed"] });
  expect(f.visits).toEqual([]);
});

test("session, CSRF, method and document authorization are enforced before recording", async () => {
  const anonymous = fixture();
  expect((await handlePrefetchRequest(anonymous.request("session"), anonymous.context, anonymous.gateway)).status).toBe(401);
  const f = fixture(true);
  for (const [scope, slug, origin, status] of [["session", "allowed", "https://evil.test", 403], ["session", "denied", "https://example.test", 404], ["public", "denied", "https://example.test", 404], ["public", "gone", "https://example.test", 404]] as const) {
    expect((await handlePrefetchRequest(f.request(scope, slug, origin), f.context, f.gateway)).status).toBe(status);
  }
  expect(f.visits).toEqual([]);
  expect((await handlePrefetchRequest(f.request("session", "allowed"), f.context, f.gateway)).status).toBe(204);
  expect(f.visits).toEqual(["allowed"]);
});

test("missing configuration fails closed without disabling the reader", async () => {
  const f = fixture();
  expect(await (await handlePrefetchRequest(f.request(), f.context, null)).json()).toEqual({ enabled: false, slugs: [] });
});

test("real-backend QA can opt out of recording without bypassing reader access", async () => {
  const f = fixture();
  const request = f.request("public", "public");
  request.headers.set("x-wiki-test-run", "1");
  expect((await handlePrefetchRequest(request, f.context, f.gateway)).status).toBe(204);
  expect(f.visits).toEqual([]);
  const session = f.request("session", "allowed");
  session.headers.set("x-wiki-test-run", "1");
  expect((await handlePrefetchRequest(session, f.context, f.gateway)).status).toBe(401);
});
