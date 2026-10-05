// Shared fixture for the chat / PII security regression tests. It runs the REAL
// app server handlers (handleChatRoute, handleToolsRequest, the conversation
// owner resolution) against the REAL Convex functions via convex-test, and
// replaces only the language model with a scripted mock that records exactly
// what the model is shown. Nothing here talks to a network or a live model.
import { MockLanguageModelV3 } from "ai/test";
import { _resetSystemPromptCache } from "../../../packages/chat/src/system-prompt-cache.js";
import { convexTest } from "convex-test";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { insertDocument } from "../convex/lib/documentMeta";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "../convex/lib/serviceAuth";
import { conversationGateVersion } from "../convex/lib/conversationAuth";
import { createSessionToken, hashSessionToken, USER_SESSION_COOKIE } from "./user-auth";

export const SITE = "diana";
export const SECRET_BODY = "SECRET_BODY_MARKER_7f3a";
export const SECRET_TITLE = "SECRET_TITLE_MARKER_91bc";
export const SECRET_TAG = "secret-tag-marker";
export const SECRET_SLUGS = ["private/care-team-notes", "private/family-contacts"];
export const PUBLIC_NEEDLE = "needle";

export const serviceIdentity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };

const modules = {
  "../access.ts": () => import("../convex/access"),
  "../conversations.ts": () => import("../convex/conversations"),
  "../documents.ts": () => import("../convex/documents"),
  "../sites.ts": () => import("../convex/sites"),
  "../users.ts": () => import("../convex/users"),
  "../_generated/server.js": () => import("../convex/_generated/server"),
};

export type Viewer = "anonymous" | "reader" | "care";

export type Options = {
  /** Make the diagnosis document itself sensitive (system-prompt context). */
  sensitiveDiagnosis?: boolean;
  passwordGate?: boolean;
};

export async function createFixture({ sensitiveDiagnosis = false, passwordGate = true }: Options = {}) {
  // Convex ids are deterministic in convex-test, so a cached prompt from a prior fixture would collide.
  _resetSystemPromptCache();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const siteId = await ctx.db.insert("sites", {
      slug: SITE, name: "Diana", domains: ["diana.test"], ownerEmail: "owner@test.invalid", status: "active",
      publishTokenHash: "fixture", documentMetaReadyAt: 1,
      config: { passwordGate, passwordHash: "fixture-gate-hash", enableChat: true, enableComments: false, enableDownloads: false },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const doc = (slug: string, title: string, content: string, extra: { sensitive?: boolean; tags?: string[] } = {}) =>
      insertDocument(ctx, { siteId, slug, title, content, tags: extra.tags ?? [], sensitive: extra.sensitive ?? false, updatedAt: 1 });
    await doc("index", "Home", "PAGE_INDEX_PUBLIC. Contact Diana Laster at diana.pechter@gmail.com. See [[wiki/public-note]].");
    await doc("wiki/diagnostics/diagnosis", sensitiveDiagnosis ? "Diagnosis" : "Diagnosis",
      sensitiveDiagnosis ? `DIAGNOSIS_SENSITIVE_CONTEXT ${SECRET_BODY}` : "DIAGNOSIS_PUBLIC_CONTEXT stage III",
      { sensitive: sensitiveDiagnosis });
    await doc("wiki/public-note", "Public note", `Public ${PUBLIC_NEEDLE} text. MRN 88855655.`,
      { tags: ["public-tag"] });
    await doc("wiki/links-to-private", "Links page", "Mentions [[private/care-team-notes]], [[private/family-contacts]] and [[wiki/public-note]].");
    await doc("private/care-team-notes", SECRET_TITLE, `${SECRET_BODY} ${PUBLIC_NEEDLE} care team text`, { sensitive: true, tags: [SECRET_TAG] });
    await doc("private/family-contacts", `${SECRET_TITLE} family`, `${SECRET_BODY} ${PUBLIC_NEEDLE} phone numbers`, { sensitive: true, tags: [SECRET_TAG] });
    await doc("private/unprotected", "Unprotected sensitive", `${SECRET_BODY} no role grants this`, { sensitive: true });

    const mkUser = (email: string) => ctx.db.insert("users", { siteId, email, name: email, passwordHash: "x", passwordSalt: "x", createdAt: 1, updatedAt: 1 });
    const care = await mkUser("care@local.test");
    const reader = await mkUser("reader@local.test");
    const role = await ctx.db.insert("roles", { siteId, name: "CareTeam", createdAt: 1, updatedAt: 1 });
    const assignment = await ctx.db.insert("userRoles", { siteId, userId: care, roleId: role, createdAt: 1 });
    await ctx.db.insert("rolePermissions", { siteId, roleId: role, includePathPatterns: ["private/care-team-notes", "private/family-contacts"], createdAt: 1 });
    return { siteId, care, reader, role, assignment };
  });
  const service = t.withIdentity(serviceIdentity);
  const tokens: Record<"reader" | "care", string> = { reader: createSessionToken(), care: createSessionToken() };
  await t.run(async (ctx) => {
    for (const [who, userId] of [["reader", ids.reader], ["care", ids.care]] as const) {
      await ctx.db.insert("userSessions", { siteId: ids.siteId, userId, tokenHash: hashSessionToken(tokens[who]), createdAt: 1, expiresAt: Date.now() + 3_600_000 });
    }
  });

  /** A ConvexHttpClient-shaped adapter over convex-test. `vectorHits` stands in for
   * the vector index (convex-test has none): the backend filters them by
   * includeSensitive exactly like documents.vectorSearch; `hostileVector` makes
   * the backend IGNORE includeSensitive, proving the app layer filters too. */
  const state = { vectorSlugs: [] as string[], hostileVector: false, calls: 0 };
  const client = {
    query: (ref: never, args: never) => service.query(ref, args),
    mutation: (ref: never, args: never) => service.mutation(ref, args),
    action: async (ref: never, args: { includeSensitive?: boolean; siteSlug?: string }) => {
      void ref;
      state.calls += 1;
      const hits = [];
      for (const slug of state.vectorSlugs) {
        const doc = await service.query(api.documents.getBySlug, { siteSlug: SITE, slug, includeSensitive: true });
        if (!doc) continue;
        if (doc.sensitive === true && !args.includeSensitive && !state.hostileVector) continue;
        hits.push({ slug: doc.slug, title: doc.title, tags: doc.tags, score: 0.9 });
      }
      return hits;
    },
  } as unknown as ConvexHttpClient;

  const site = (await t.run((ctx) => ctx.db.get(ids.siteId)))!;
  const browser = (ownerKey?: string) => t.withIdentity({
    issuer: SERVICE_ISSUER, subject: `wiki-browser:${SITE}`, role: "wiki-conversations", siteSlug: SITE,
    gateVersion: conversationGateVersion(site), ...(ownerKey ? { ownerKey } : {}),
  });

  return { t, service, client, ids, tokens, state, browser, site };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export function cookieFor(fixture: Fixture, viewer: Viewer, extra = "") {
  const parts = [] as string[];
  if (viewer !== "anonymous") parts.push(`${USER_SESSION_COOKIE}=${fixture.tokens[viewer]}`);
  if (extra) parts.push(extra);
  return parts.join("; ");
}

export function jsonRequest(path: string, body: unknown, cookie = "") {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

type ScriptedCall = { name: string; input: Record<string, unknown> };

/** Scripted model: step 1 calls every tool in `calls`; step 2 answers with
 * `answer`. `seen` records every prompt the model was shown. */
export function scriptedModel(calls: ScriptedCall[], answer = "All done.") {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      // Tool results in the prompt mean the tools already ran: answer now.
      const toolsRan = prompt.some((message) => message.role === "tool");
      const chunks = !toolsRan && calls.length > 0
        ? [
            { type: "stream-start", warnings: [] },
            ...calls.map((call, index) => ({ type: "tool-call", toolCallId: `call-${index}`, toolName: call.name, input: JSON.stringify(call.input) })),
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: answer },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ];
      return { stream: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }) } as never;
    },
  });
  return model;
}

export function installModel(model: MockLanguageModelV3) {
  (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER = {
    specificationVersion: "v3",
    languageModel: () => model,
  };
  process.env.AI_GATEWAY_API_KEY ||= "test-gateway-key";
}

export function uninstallModel() {
  delete (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER;
}

/** Everything a model was shown, split into system prompt and tool outputs. */
export function shownToModel(model: MockLanguageModelV3) {
  const system: string[] = [];
  const toolOutputs: unknown[] = [];
  for (const call of model.doStreamCalls) {
    for (const message of call.prompt) {
      if (message.role === "system") system.push(String(message.content));
      if (message.role === "tool") for (const part of message.content) if (part.type === "tool-result") toolOutputs.push(part.output);
    }
  }
  return { system: system.join("\n"), toolOutputs, everything: JSON.stringify(model.doStreamCalls.map((call) => call.prompt)) };
}
