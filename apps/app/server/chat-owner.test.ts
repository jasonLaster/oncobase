import { afterAll, expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { conversationOwnerKey } from "../convex/lib/conversationAuth";
import { CHAT_OWNER_COOKIE, chatOwnerCookieFromHeader, resolveChatOwner } from "./chat-owner";
import { createWikiApiHandler } from "./wiki-api";

const previousKey = process.env.WIKI_BACKEND_SIGNING_KEY;
afterAll(() => {
  if (previousKey === undefined) delete process.env.WIKI_BACKEND_SIGNING_KEY;
  else process.env.WIKI_BACKEND_SIGNING_KEY = previousKey;
});
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const signingKey = JSON.stringify({ ...await crypto.subtle.exportKey("jwk", pair.privateKey), kid: "chat-owner-fixture" });
const claimsOf = (token: string) => JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));

function fakeClient(enableChat: boolean) {
  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "sites:getBySlug":
          return { _id: "site-fixture", slug: args.slug, config: { passwordGate: false, enableChat } };
        case "users:getSessionUser":
          return null;
        default:
          return null;
      }
    },
    async mutation() { return null; },
    async action() { return null; },
  };
}

function tokenRequest(cookie?: string) {
  return new Request("http://127.0.0.1/api/wiki/convex-token", { headers: { Host: "127.0.0.1", ...(cookie ? { Cookie: cookie } : {}) } });
}

test("owner keys are per principal and per site, and never echo the raw cookie", () => {
  const request = new Request("https://wiki.test/", { headers: { Cookie: `${CHAT_OWNER_COOKIE}=AAAAAAAAAAAAAAAAAAAAAA` } });
  const anonymous = resolveChatOwner(request, "alpha", null);
  expect(anonymous).toEqual({ ownerKey: conversationOwnerKey("alpha", "anon:AAAAAAAAAAAAAAAAAAAAAA") });
  expect(anonymous.ownerKey).not.toContain("AAAAAAAAAAAAAAAAAAAAAA");
  expect(resolveChatOwner(request, "beta", null).ownerKey).not.toBe(anonymous.ownerKey);
  // Signed-in users own by account, whatever anonymous cookie they carry.
  const user = resolveChatOwner(request, "alpha", { _id: "user-1" });
  expect(user.ownerKey).toBe(conversationOwnerKey("alpha", "user:user-1"));
  expect(resolveChatOwner(new Request("https://wiki.test/"), "alpha", { _id: "user-1" }).ownerKey).toBe(user.ownerKey);
});

test("a caller without an owner never gets a reusable or empty owner key", () => {
  const bare = new Request("https://wiki.test/");
  const first = resolveChatOwner(bare, "alpha", null);
  expect(first.setCookie).toBeUndefined();
  expect(first.ownerKey).toMatch(/^[0-9a-f]{64}$/);
  expect(resolveChatOwner(bare, "alpha", null).ownerKey).not.toBe(first.ownerKey);
  // Malformed cookies are ignored rather than trusted as a principal.
  expect(chatOwnerCookieFromHeader(`${CHAT_OWNER_COOKIE}=short`)).toBeUndefined();
  const issued = resolveChatOwner(bare, "alpha", null, { issue: true });
  expect(issued.setCookie).toMatch(new RegExp(`^${CHAT_OWNER_COOKIE}=[A-Za-z0-9_-]{22}; HttpOnly; SameSite=Lax; Path=/; Max-Age=\\d+; Secure$`));
});

test("convex-token sets an httpOnly owner cookie once and signs only its hash", async () => {
  process.env.WIKI_BACKEND_SIGNING_KEY = signingKey;
  const handler = createWikiApiHandler(fakeClient(true) as never);
  const first = (await handler(tokenRequest()))!;
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("private, no-store");
  const setCookie = first.headers.get("set-cookie")!;
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
  const cookie = setCookie.split(";")[0]!;
  const raw = cookie.slice(CHAT_OWNER_COOKIE.length + 1);
  const { token } = await first.json() as { token: string };
  const claims = claimsOf(token);
  expect(claims).toMatchObject({ role: "wiki-conversations", siteSlug: "diana", sub: "wiki-browser:diana" });
  expect(claims.ownerKey).toBe(conversationOwnerKey("diana", `anon:${raw}`));
  expect(token).not.toContain(raw);

  // A returning viewer keeps the same owner and is not issued a new cookie.
  const second = (await handler(tokenRequest(cookie)))!;
  expect(second.headers.get("set-cookie")).toBeNull();
  expect(claimsOf((await second.json() as { token: string }).token).ownerKey).toBe(claims.ownerKey);

  // Another viewer gets a different owner.
  const other = (await handler(tokenRequest()))!;
  expect(claimsOf((await other.json() as { token: string }).token).ownerKey).not.toBe(claims.ownerKey);
});

test("convex-token is unavailable when chat is disabled for the site", async () => {
  process.env.WIKI_BACKEND_SIGNING_KEY = signingKey;
  const handler = createWikiApiHandler(fakeClient(false) as never);
  const response = (await handler(tokenRequest()))!;
  expect(response.status).toBe(404);
  expect(response.headers.get("set-cookie")).toBeNull();
});
