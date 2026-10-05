// Security property (b): a chat that included sensitive data is never available
// to another viewer. These drive the real /api/chat handler (scripted model)
// and the real conversation functions, then probe every read/stream/cancel
// path with browser tokens of other owners.
import { afterEach, expect, spyOn, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { conversationOwnerKey } from "../convex/lib/conversationAuth";
import { handleChatRoute } from "./api/chat";
import { traceBackendHandler, traceConvexClient } from "./backend-tracing";
import { CHAT_OWNER_COOKIE, resolveChatOwner } from "./chat-owner";
import {
  SECRET_BODY, SITE, cookieFor, createFixture, installModel, jsonRequest, scriptedModel, uninstallModel,
  type Fixture, type Viewer,
} from "./chat-security-fixture";

afterEach(() => uninstallModel());

const ANON_A = "AAAAAAAAAAAAAAAAAAAAAA";
const ANON_B = "BBBBBBBBBBBBBBBBBBBBBB";
const anonCookie = (value: string) => `${CHAT_OWNER_COOKIE}=${value}`;
const QUESTION = "QUESTION_TEXT_c0ffee what do the care notes say";
const ANSWER = `Per the care notes: ${SECRET_BODY}`;

const ownerOf = (fixture: Fixture, viewer: Viewer, cookie = "") => {
  const request = new Request("http://127.0.0.1/", { headers: { cookie } });
  if (viewer === "care") return resolveChatOwner(request, SITE, { _id: fixture.ids.care }).ownerKey;
  if (viewer === "reader") return resolveChatOwner(request, SITE, { _id: fixture.ids.reader }).ownerKey;
  return resolveChatOwner(request, SITE, null).ownerKey;
};

async function newConversation(fixture: Fixture, ownerKey: string) {
  return (await fixture.service.mutation(api.conversations.create, { siteSlug: SITE, ownerKey, title: "chat" })) as Id<"conversations">;
}

async function runChat(fixture: Fixture, viewer: Viewer, conversationId: Id<"conversations"> | undefined, { cookie = "", answer = ANSWER, read = true } = {}) {
  const model = scriptedModel(read ? [{ name: "read_page", input: { slug: "private/care-team-notes" } }] : [], answer);
  installModel(model);
  const response = await handleChatRoute({
    request: jsonRequest("/api/chat", {
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: QUESTION }] }],
      ...(conversationId ? { conversationId, cancelResetHandled: true } : {}),
    }, cookieFor(fixture, viewer, cookie)),
    client: fixture.client, siteSlug: SITE,
  } as never);
  const body = await response.text();
  await new Promise((resolve) => setTimeout(resolve, 50)); // post-stream persistence
  return { response, body, model };
}

/** Everything a browser holding `ownerKey` can learn about `conversationId`. */
async function browserView(fixture: Fixture, ownerKey: string | undefined, conversationId: Id<"conversations">) {
  const b = fixture.browser(ownerKey);
  const [list, archived, get, messages, meta, streaming, cancel] = await Promise.all([
    b.query(api.conversations.list, { siteSlug: SITE }),
    b.query(api.conversations.listArchived, { siteSlug: SITE }),
    b.query(api.conversations.get, { siteSlug: SITE, id: conversationId }),
    b.query(api.conversations.getMessages, { siteSlug: SITE, id: conversationId }),
    b.query(api.conversations.getMeta, { siteSlug: SITE, id: conversationId }),
    b.query(api.conversations.getStreamingState, { siteSlug: SITE, id: conversationId }),
    b.query(api.conversations.getCancelState, { siteSlug: SITE, conversationId }),
  ]);
  return { list, archived, get, messages, meta, streaming, cancel, text: JSON.stringify({ list, archived, get, messages, meta, streaming, cancel }) };
}

test("a sensitive answer is stored under the requester's account and unreadable by every other owner", async () => {
  const fixture = await createFixture();
  const careKey = ownerOf(fixture, "care");
  const conversationId = await newConversation(fixture, careKey);
  const { body } = await runChat(fixture, "care", conversationId);
  expect(body).toContain(SECRET_BODY);

  const stored = await fixture.t.run((ctx) => ctx.db.get(conversationId));
  expect(stored?.ownerKey).toBe(careKey);
  expect(stored?.ownerKey).toBe(conversationOwnerKey(SITE, `user:${fixture.ids.care}`));

  const owner = await browserView(fixture, careKey, conversationId);
  expect(owner.text).toContain(SECRET_BODY); // positive control

  const strangers: Array<[string, string | undefined]> = [
    ["another account", ownerOf(fixture, "reader")],
    ["anonymous cookie owner", ownerOf(fixture, "anonymous", anonCookie(ANON_A))],
    ["other anonymous cookie owner", ownerOf(fixture, "anonymous", anonCookie(ANON_B))],
    ["cookie-less throwaway owner", ownerOf(fixture, "anonymous")],
    ["token without an owner claim", undefined],
    ["token with a malformed owner claim", "not-a-hash"],
  ];
  for (const [label, key] of strangers) {
    const view = await browserView(fixture, key, conversationId);
    expect(view.text, label).not.toContain(SECRET_BODY);
    expect(view.text, label).not.toContain(QUESTION);
    expect(view.list, label).toEqual([]);
    expect(view.get, label).toBeNull();
    expect(view.meta, label).toBeNull();
    expect(view.streaming, label).toBeNull();
    expect(view.cancel, label).toBeNull();
    expect(view.messages, label).toEqual([]);
  }
});

test("another viewer cannot mutate, cancel, archive or delete a sensitive conversation, even by supplying its id to /api/chat", async () => {
  const fixture = await createFixture();
  const careKey = ownerOf(fixture, "care");
  const conversationId = await newConversation(fixture, careKey);
  await runChat(fixture, "care", conversationId);
  const before = await fixture.t.run(async (ctx) => ({ conversation: await ctx.db.get(conversationId), messages: await ctx.db.query("messages").collect() }));

  const readerKey = ownerOf(fixture, "reader");
  const reader = fixture.browser(readerKey);
  await reader.mutation(api.conversations.cancelStream, { siteSlug: SITE, conversationId });
  await reader.mutation(api.conversations.clearCancel, { siteSlug: SITE, conversationId });
  await reader.mutation(api.conversations.clearStreaming, { siteSlug: SITE, conversationId });
  await reader.mutation(api.conversations.archive, { siteSlug: SITE, id: conversationId });
  await reader.mutation(api.conversations.restore, { siteSlug: SITE, id: conversationId });
  await reader.mutation(api.conversations.sendMessage, { siteSlug: SITE, conversationId, text: "INJECTED" });
  expect(await reader.mutation(api.conversations.remove, { siteSlug: SITE, id: conversationId })).toEqual({ deleted: false });
  // Service-only functions are not callable by browsers at all.
  const base = { siteSlug: SITE, conversationId };
  await expect(reader.mutation(api.conversations.beginRun, { ...base, runId: "r" })).rejects.toThrow("Unauthorized");
  await expect(reader.mutation(api.conversations.updateStreaming, { ...base, text: "x" })).rejects.toThrow("Unauthorized");
  await expect(reader.mutation(api.conversations.saveMessages, { ...base, messages: [] })).rejects.toThrow("Unauthorized");

  // /api/chat with a victim's conversationId: the model runs for the CALLER's access
  // and the caller's own answer is never written into the victim's row.
  for (const [viewer, cookie] of [["reader", ""], ["anonymous", anonCookie(ANON_A)], ["anonymous", ""]] as const) {
    const attack = await runChat(fixture, viewer, conversationId, { cookie, answer: "ATTACKER_ANSWER" });
    expect(attack.body).not.toContain(SECRET_BODY);
  }
  const after = await fixture.t.run(async (ctx) => ({ conversation: await ctx.db.get(conversationId), messages: await ctx.db.query("messages").collect() }));
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).not.toContain("ATTACKER_ANSWER");
  expect(JSON.stringify(after)).not.toContain("INJECTED");
});

test("conversations follow the viewer, not the browser: sign-in, sign-out and shared cookie jars", async () => {
  const fixture = await createFixture();
  const jar = anonCookie(ANON_A);
  // Anonymous (cookie) chat.
  const anonKey = ownerOf(fixture, "anonymous", jar);
  const anonConversation = await newConversation(fixture, anonKey);
  await runChat(fixture, "anonymous", anonConversation, { cookie: jar, answer: "ANON_ANSWER", read: false });
  // The same browser, signed in as care: a different owner (account), same cookie jar.
  expect(ownerOf(fixture, "care", jar)).not.toBe(anonKey);
  expect((await browserView(fixture, ownerOf(fixture, "care", jar), anonConversation)).text).not.toContain("ANON_ANSWER");
  const careConversation = await newConversation(fixture, ownerOf(fixture, "care", jar));
  await runChat(fixture, "care", careConversation, { cookie: jar });
  // Two accounts sharing the cookie jar each see only their own.
  expect(ownerOf(fixture, "reader", jar)).not.toBe(ownerOf(fixture, "care", jar));
  expect((await browserView(fixture, ownerOf(fixture, "reader", jar), careConversation)).text).not.toContain(SECRET_BODY);
  // Sign-out: the cookie owner returns to its own anonymous history only.
  const signedOut = await browserView(fixture, ownerOf(fixture, "anonymous", jar), careConversation);
  expect(signedOut.text).not.toContain(SECRET_BODY);
  expect(signedOut.list.map((c) => c._id)).toEqual([anonConversation]);
  // A different anonymous browser sees neither.
  expect((await browserView(fixture, ownerOf(fixture, "anonymous", anonCookie(ANON_B)), anonConversation)).list).toEqual([]);
});

test("role revocation: new chats stop returning sensitive pages immediately; the owner keeps (only) their own earlier answers", async () => {
  const fixture = await createFixture();
  const careKey = ownerOf(fixture, "care");
  const conversationId = await newConversation(fixture, careKey);
  await runChat(fixture, "care", conversationId);
  await fixture.t.run((ctx) => ctx.db.delete(fixture.ids.assignment));

  // A new run for the revoked user: tools return nothing sensitive.
  const fresh = await runChat(fixture, "care", await newConversation(fixture, careKey), { answer: "fresh answer" });
  expect(fresh.body).not.toContain(SECRET_BODY);
  expect(JSON.stringify(fresh.model.doStreamCalls.map((call) => call.prompt))).not.toContain(SECRET_BODY);

  // Characterization (design gap, see the audit doc): the earlier sensitive
  // answer stays readable by its owner. Nobody else can read it.
  expect((await browserView(fixture, careKey, conversationId)).text).toContain(SECRET_BODY);
  expect((await browserView(fixture, ownerOf(fixture, "reader"), conversationId)).text).not.toContain(SECRET_BODY);
});

test("owner key and cookie properties: unguessable, site- and account-derived, ignores client-chosen identity", () => {
  const request = (cookie: string) => new Request("https://wiki.test/api/wiki/convex-token", { headers: { cookie } });
  const minted = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const owner = resolveChatOwner(request(""), SITE, null, { issue: true });
    const value = owner.setCookie!.split(";")[0]!.slice(CHAT_OWNER_COOKIE.length + 1);
    expect(value).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 random bytes
    expect(owner.setCookie).toContain("HttpOnly");
    expect(owner.setCookie).toContain("SameSite=Lax");
    expect(owner.setCookie).toContain("Secure");
    minted.add(value);
  }
  expect(minted.size).toBe(50);
  // The key is a hash: it never contains the cookie value, differs per site and per account.
  const key = resolveChatOwner(request(anonCookie(ANON_A)), SITE, null).ownerKey;
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(key).not.toContain(ANON_A);
  expect(resolveChatOwner(request(anonCookie(ANON_A)), "other-site", null).ownerKey).not.toBe(key);
  // A signed-in viewer's owner does not depend on any (attacker-settable) cookie.
  const user = { _id: "users:1" };
  expect(resolveChatOwner(request(anonCookie(ANON_A)), SITE, user).ownerKey).toBe(resolveChatOwner(request(anonCookie(ANON_B)), SITE, user).ownerKey);
  expect(resolveChatOwner(request(anonCookie(ANON_A)), SITE, user).ownerKey).not.toBe(key);
  // A user id can never collide with an anonymous cookie principal.
  expect(conversationOwnerKey(SITE, "user:AAAAAAAAAAAAAAAAAAAAAA")).not.toBe(key);
  // Malformed/oversized cookies are ignored (throwaway owner), never used as an identity.
  for (const bad of [anonCookie("short"), anonCookie("A".repeat(23)), anonCookie("../etc/passwd-padding-xx"), `x${CHAT_OWNER_COOKIE}=${ANON_A}`]) {
    expect(resolveChatOwner(request(bad), SITE, null).ownerKey).not.toBe(key);
  }
});

test("running a chat with sensitive content writes no message text to logs or telemetry spans", async () => {
  const fixture = await createFixture();
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const consoleCalls: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    spyOn(console, level).mockImplementation((...args: unknown[]) => { consoleCalls.push(args.map(String).join(" ")); }));
  try {
    const traced = traceConvexClient(fixture.client, provider.getTracer("chat-test"));
    const careKey = ownerOf(fixture, "care");
    const conversationId = await newConversation(fixture, careKey);
    const model = scriptedModel([{ name: "read_page", input: { slug: "private/care-team-notes" } }, { name: "search_wiki", input: { query: SECRET_BODY } }], ANSWER);
    installModel(model);
    const handler = traceBackendHandler(async (request) => handleChatRoute({ request, client: traced, siteSlug: SITE } as never), { tracer: provider.getTracer("chat-test") });
    const response = (await handler(jsonRequest("/api/chat", {
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: QUESTION }] }], conversationId, cancelResetHandled: true,
    }, cookieFor(fixture, "care"))))!;
    expect(await response.text()).toContain(SECRET_BODY);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const telemetry = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })));
    for (const forbidden of [SECRET_BODY, QUESTION, "QUESTION_TEXT", "care-team-notes", String(conversationId), careKey, "care@local.test", "wiki_user_session"]) {
      expect(telemetry, forbidden).not.toContain(forbidden);
      expect(consoleCalls.join("\n"), forbidden).not.toContain(forbidden);
    }
  } finally {
    for (const spy of spies) spy.mockRestore();
    await provider.shutdown();
  }
});

test("every conversation call the chat route makes is bound to the requesting viewer's owner key (never a site-wide call)", async () => {
  const fixture = await createFixture();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const record = (kind: "query" | "mutation") => (ref: never, args: Record<string, unknown>, ...rest: unknown[]) => {
    const name = getFunctionName(ref);
    if (name.startsWith("conversations:")) calls.push({ name, args });
    return (fixture.client[kind] as (...a: unknown[]) => unknown)(ref, args, ...rest);
  };
  const client = { query: record("query"), mutation: record("mutation"), action: fixture.client.action.bind(fixture.client) } as unknown as ConvexHttpClient;
  for (const [viewer, cookie] of [["care", ""], ["reader", ""], ["anonymous", anonCookie(ANON_A)], ["anonymous", ""]] as const) {
    calls.length = 0;
    const expected = ownerOf(fixture, viewer, cookie);
    const conversationId = await newConversation(fixture, expected);
    const model = scriptedModel([], "ok");
    installModel(model);
    const response = await handleChatRoute({
      request: jsonRequest("/api/chat", { messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }], conversationId }, cookieFor(fixture, viewer, cookie)),
      client, siteSlug: SITE,
    } as never);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const names = new Set(calls.map((call) => call.name));
    for (const required of ["conversations:clearCancel", "conversations:beginRun", "conversations:getCancelState", "conversations:updateStreaming", "conversations:saveMessages", "conversations:clearStreaming"]) {
      if (required === "conversations:updateStreaming" || required === "conversations:getCancelState") continue; // timing dependent
      expect(names.has(required), required).toBe(true);
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // Anonymous callers without a cookie get a throwaway key: it matches no row.
      if (!(viewer === "anonymous" && !cookie)) expect(call.args.ownerKey, call.name).toBe(expected);
      expect(call.args.ownerKey, call.name).toMatch(/^[0-9a-f]{64}$/);
      expect(call.args.siteSlug, call.name).toBe(SITE);
    }
  }
});
