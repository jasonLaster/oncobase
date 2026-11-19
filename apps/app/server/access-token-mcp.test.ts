// Access tokens (POST /api/auth/tokens) and the MCP endpoint (/api/mcp),
// through the real API handler and gate against real Convex functions.
import { beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createWikiChatTools } from "./chat-agent";
import { PUBLIC_NEEDLE, SECRET_BODY, SITE, createFixture } from "./chat-security-fixture";
import { createPasswordSalt, hashPassword } from "./user-auth";
import { createWikiApiHandler } from "./wiki-api";

beforeAll(() => { process.env.NODE_ENV = "test"; });

const SITE_PASSWORD = "fixture-site-password";
const CARE_PASSWORD = "care-password-123";

async function setup() {
  const fixture = await createFixture();
  await fixture.t.run(async (ctx) => {
    const site = (await ctx.db.get(fixture.ids.siteId))!;
    await ctx.db.patch(fixture.ids.siteId, {
      config: { ...site.config, passwordHash: `sha256:${createHash("sha256").update(SITE_PASSWORD).digest("hex")}` },
    });
    const salt = createPasswordSalt();
    await ctx.db.patch(fixture.ids.care, { passwordSalt: salt, passwordHash: hashPassword(CARE_PASSWORD, salt) });
  });
  const handler = createWikiApiHandler(fixture.client);
  const call = async (path: string, { body, token, method = body === undefined ? "GET" : "POST" }: { body?: unknown; token?: string; method?: string } = {}) =>
    (await handler(new Request(`http://127.0.0.1${path}`, {
      method,
      headers: {
        host: "127.0.0.1",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })))!;
  /** id null sends a notification (no id). */
  const rpc = (token: string | undefined, method: string, params?: unknown, id: number | null = 1) =>
    call("/api/mcp", { token, body: { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) } });
  return { fixture, call, rpc };
}

test("an account swaps email and password for a bearer token that passes the gate and reads its pages", async () => {
  const { call } = await setup();
  expect((await call("/api/auth/tokens", { body: { email: "care@local.test", password: "wrong" } })).status).toBe(401);
  expect((await call("/api/auth/tokens", { body: { email: "care@local.test" } })).status).toBe(400);

  const minted = await call("/api/auth/tokens", { body: { email: "CARE@local.test", password: CARE_PASSWORD } });
  expect(minted.status).toBe(200);
  expect(minted.headers.get("set-cookie")).toBeNull();
  const { token, tokenType, mcpUrl, expiresAt } = await minted.json();
  expect(tokenType).toBe("Bearer");
  expect(mcpUrl).toBe("http://127.0.0.1/api/mcp");
  expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now() + 300 * 86_400_000);

  // No cookie jar: the token alone passes the site gate and acts as the account.
  expect((await call("/api/tools")).status).toBe(401);
  const session = await call("/api/wiki/session?scope=session", { token });
  expect(session.status).toBe(200);
  expect((await session.json()).authenticated).toBe(true);
  const read = await call("/api/tools", { token, body: { tool: "read_page", args: { slug: "private/care-team-notes" } } });
  expect(JSON.stringify(await read.json())).toContain(SECRET_BODY);
  const queryParam = await call(`/api/tools?access_token=${encodeURIComponent(token)}`);
  expect(queryParam.status).toBe(200);

  // Sign-out with the token revokes it.
  expect((await call("/api/auth/signout", { token, body: {} })).status).toBe(200);
  expect((await call("/api/tools", { token })).status).toBe(401);
});

test("the site password as a bearer token passes the gate with public scope only", async () => {
  const { call } = await setup();
  expect((await call("/api/tools", { token: "not-the-password" })).status).toBe(401);
  const listing = await call("/api/tools", { token: SITE_PASSWORD });
  expect(listing.status).toBe(200);
  const read = await call("/api/tools", { token: SITE_PASSWORD, body: { tool: "read_page", args: { slug: "private/care-team-notes" } } });
  expect(JSON.stringify(await read.json())).not.toContain(SECRET_BODY);
  const session = await call("/api/wiki/session?scope=session", { token: SITE_PASSWORD });
  expect(session.status).toBe(401);
});

test("MCP: handshake, the chat toolset, tool calls and errors", async () => {
  const { rpc, call } = await setup();
  expect((await rpc(undefined, "initialize", { protocolVersion: "2025-06-18" })).status).toBe(401);

  const init = await rpc(SITE_PASSWORD, "initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" },
  });
  expect(init.status).toBe(200);
  const { result } = await init.json();
  expect(result.protocolVersion).toBe("2025-06-18");
  expect(result.capabilities.tools).toBeDefined();
  expect(result.instructions).toContain("grep_wiki");
  expect((await rpc(SITE_PASSWORD, "initialize", { protocolVersion: "1999-01-01" }).then((r) => r.json())).result.protocolVersion)
    .toBe("2025-11-25");

  const notified = await rpc(SITE_PASSWORD, "notifications/initialized", undefined, null);
  expect(notified.status).toBe(202);

  const list = await (await rpc(SITE_PASSWORD, "tools/list")).json();
  const chatTools = Object.keys(createWikiChatTools({ documents: {} as never, piiPatterns: [], embedQuery: async () => null }));
  expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(chatTools);
  expect(list.result.tools.every((tool: { inputSchema: { type: string } }) => tool.inputSchema.type === "object")).toBe(true);

  const grep = await (await rpc(SITE_PASSWORD, "tools/call", { name: "grep_wiki", arguments: { text: PUBLIC_NEEDLE } })).json();
  expect(grep.result.isError).toBeUndefined();
  const grepOutput = JSON.parse(grep.result.content[0].text);
  expect(grepOutput.results.map((hit: { slug: string }) => hit.slug)).toContain("wiki/public-note");
  expect(grepOutput.results.map((hit: { slug: string }) => hit.slug)).not.toContain("private/care-team-notes");

  const bad = await (await rpc(SITE_PASSWORD, "tools/call", { name: "grep_wiki", arguments: { text: "x" } })).json();
  expect(bad.result.isError).toBe(true);
  expect((await (await rpc(SITE_PASSWORD, "tools/call", { name: "nope" })).json()).error.code).toBe(-32602);
  expect((await (await rpc(SITE_PASSWORD, "resources/list")).json()).error.code).toBe(-32601);
  expect((await call("/api/mcp", { token: SITE_PASSWORD })).status).toBe(405);

  const batch = await call("/api/mcp", { token: SITE_PASSWORD, body: [
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ] });
  expect((await batch.json()).map((reply: { id: number }) => reply.id)).toEqual([1, 2]);
});

test("MCP with an account token reads that account's sensitive pages", async () => {
  const { call, rpc } = await setup();
  const { token } = await (await call("/api/auth/tokens", { body: { email: "care@local.test", password: CARE_PASSWORD } })).json();
  const read = await (await rpc(token, "tools/call", { name: "read_page", arguments: { slug: "private/care-team-notes" } })).json();
  expect(read.result.content[0].text).toContain(SECRET_BODY);
  const ungranted = await (await rpc(token, "tools/call", { name: "read_page", arguments: { slug: "private/unprotected" } })).json();
  expect(ungranted.result.content[0].text).not.toContain(SECRET_BODY);
  const grep = await (await rpc(token, "tools/call", { name: "grep_wiki", arguments: { text: PUBLIC_NEEDLE } })).json();
  expect(grep.result.content[0].text).toContain("private/care-team-notes");
  void SITE;
});
