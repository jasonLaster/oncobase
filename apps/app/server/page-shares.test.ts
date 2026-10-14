import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { handlePageShares, SHARE_HEADERS } from "./api/page-shares";
import { createWikiApiHandler } from "./wiki-api";
import { createWikiViteHandler } from "./app-shell";

const token = "x".repeat(43);
function request(path: string, method = "POST", body: unknown = { token }, headers: HeadersInit = {}) {
  return new Request(`http://127.0.0.1${path}`, { method, headers: { Origin: "http://127.0.0.1", "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}

function fakeClient() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    query: async (ref: never, args: Record<string, unknown>) => {
      const name = getFunctionName(ref); calls.push({ name, args });
      if (name === "sites:getBySlug") return { slug: "diana", config: { passwordGate: true, passwordHash: "fixture" } };
      if (name === "pageShares:read") return args.tokenHash === createHash("sha256").update(token).digest("hex")
        ? { slug: "private/fixture", title: "Fixture", tags: [], content: "ONLY_SHARED_PAGE" } : null;
      if (name === "pageShares:status") throw new ConvexError("Forbidden");
      if (name === "pageShares:asset") return null;
      throw new Error(`Unexpected read ${name}`);
    },
    mutation: async (ref: never, args: Record<string, unknown>) => {
      calls.push({ name: getFunctionName(ref), args }); return true;
    },
  };
  return { client: client as never, calls };
}

test("share API bypasses the site gate only for capability reads and returns private headers", async () => {
  const { client, calls } = fakeClient();
  const handler = createWikiApiHandler(client);
  const response = await handler(request("/api/page-shares/read"));
  expect(response?.status).toBe(200);
  expect((await response!.json()).content).toBe("ONLY_SHARED_PAGE");
  for (const [header, value] of Object.entries(SHARE_HEADERS)) expect(response!.headers.get(header)).toBe(value);
  expect(calls.filter(call => call.name.startsWith("documents:") || call.name.startsWith("access:"))).toHaveLength(0);
  expect(JSON.stringify(calls)).not.toContain(token);
  const denied = await handler(request("/api/page-shares/read", "POST", { token: "y".repeat(43), slug: "private/other" }));
  expect(denied?.status).toBe(404);
  expect(await (await handler(request("/api/page-shares/asset", "POST", { token, path: "other.pdf" })))!.json()).toEqual({ error: "File unavailable" });
});

test("management requires a session; links carry fresh entropy only in the fragment", async () => {
  const { client, calls } = fakeClient();
  expect((await handlePageShares(request("/api/page-shares", "POST", { slug: "private/fixture" }), client, "diana")).status).toBe(403);
  const cookie = { Cookie: "wiki_user_session=fixture-session" };
  const response = await handlePageShares(request("/api/page-shares", "POST", { slug: "private/fixture" }, cookie), client, "diana");
  const data = await response.json(); const url = new URL(data.url);
  expect(url.pathname).toBe("/share"); expect(url.search).toBe(""); expect(url.hash.slice(1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(calls.at(-1)?.args.tokenHash).toBe(createHash("sha256").update(url.hash.slice(1)).digest("hex"));
  expect(data.active).toBe(true);
  expect(calls.at(-1)?.args).not.toHaveProperty("days");
  expect(JSON.stringify(calls)).not.toContain("fixture-session");
  const forbidden = await handlePageShares(request("/api/page-shares?slug=private/fixture", "GET", undefined, cookie), client, "diana");
  expect(forbidden.status).toBe(403);
});

test("cross-origin changes, tokenless reads, path traversal and unexpected methods are rejected", async () => {
  const { client, calls } = fakeClient();
  expect((await handlePageShares(request("/api/page-shares", "POST", {}, { Origin: "https://other.test" }), client, "diana")).status).toBe(403);
  expect((await handlePageShares(request("/api/page-shares/read", "GET"), client, "diana")).status).toBe(405);
  expect((await handlePageShares(request("/api/page-shares/read", "POST", {}), client, "diana")).status).toBe(404);
  expect((await handlePageShares(request("/api/page-shares/asset", "POST", { token, path: "../other.pdf" }), client, "diana")).status).toBe(404);
  expect(calls).toHaveLength(0);
});

test("anonymous shared HTML contains no page bootstrap and does not open other gated routes", async () => {
  const { client, calls } = fakeClient();
  const handler = createWikiViteHandler({ client, distDir: "/unused", indexHtml: "<html><head><title>Wiki</title></head><body><div id='root'></div></body></html>" });
  const response = await handler(request("/share", "GET"));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const html = await response.text();
  expect(html).toContain("Shared page"); expect(html).toContain("noindex");
  expect(html).not.toContain("ONLY_SHARED_PAGE"); expect(html).not.toContain("wiki-page-bootstrap");
  expect(calls.some(call => call.name.startsWith("documents:"))).toBe(false);
  const denied = await handler(request("/private/other", "GET"));
  expect(denied.status).toBe(302); expect(denied.headers.get("Location")).toContain("/sign-in");
});
