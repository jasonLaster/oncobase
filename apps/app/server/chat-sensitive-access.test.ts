// Security property (a): a chat run for a viewer who cannot read a sensitive
// page never retrieves, quotes or cites it, by any route the model can use.
// The real /api/chat and /api/tools handlers run against real Convex functions;
// only the model is scripted, and we assert on exactly what it was shown.
import { afterEach, beforeAll, expect, test } from "bun:test";
import { handleChatRoute } from "./api/chat";
import { handleToolsRequest } from "./api/tools";
import { createWikiApiHandler } from "./wiki-api";
import {
  PUBLIC_NEEDLE, SECRET_BODY, SECRET_SLUGS, SECRET_TAG, SECRET_TITLE, SITE,
  cookieFor, createFixture, installModel, jsonRequest, scriptedModel, shownToModel, uninstallModel,
  type Viewer,
} from "./chat-security-fixture";

afterEach(() => uninstallModel());
beforeAll(() => { process.env.NODE_ENV = "test"; });

const ALL_TOOLS = [
  { name: "search_wiki", input: { query: PUBLIC_NEEDLE } },
  { name: "read_page", input: { slug: "private/care-team-notes" } },
  { name: "read_page", input: { slug: "private/family-contacts#anchor" } },
  { name: "read_page", input: { slug: "private/care-team-notes.md" } },
  { name: "read_page", input: { slug: "/private/care-team-notes" } },
  { name: "read_page", input: { slug: "wiki/public-note" } },
  { name: "read_page", input: { slug: "wiki/links-to-private" } },
  { name: "list_pages", input: {} },
  { name: "get_pages_by_tag", input: { tag: SECRET_TAG } },
  { name: "list_tags", input: {} },
];

// Content markers. (A public page's own text may legitimately mention a
// sensitive slug in a link, so slugs are checked structurally below.)
function leaks(text: string) {
  return [SECRET_BODY, SECRET_TITLE, SECRET_TAG, "DIAGNOSIS_SENSITIVE_CONTEXT"].filter((marker) => text.includes(marker));
}

/** Every slug/href a tool surfaced as a structured field (search hits, lists,
 * linked_pages, read results), as opposed to prose inside page content. */
function surfacedSlugs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(surfacedSlugs);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      (key === "slug" || key === "href") && typeof child === "string" ? [child] : key === "content" ? [] : surfacedSlugs(child));
  }
  return [];
}
const privateSlugs = (value: unknown) => surfacedSlugs(value).filter((slug) => slug.replace(/^\//, "").startsWith("private/"));

async function chat(fixture: Awaited<ReturnType<typeof createFixture>>, viewer: Viewer, calls = ALL_TOOLS, extraCookie = "") {
  const model = scriptedModel(calls);
  installModel(model);
  const response = await handleChatRoute({
    request: jsonRequest("/api/chat", { messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "tell me about the needle" }] }] }, cookieFor(fixture, viewer, extraCookie)),
    client: fixture.client, siteSlug: SITE,
  } as never);
  expect(response.status).toBe(200);
  const streamed = await response.text();
  return { model, streamed, shown: shownToModel(model) };
}

test("chat tools never show a non-role viewer sensitive content, titles, slugs or tags (anonymous and signed-in without role)", async () => {
  const fixture = await createFixture();
  fixture.state.vectorSlugs = [...SECRET_SLUGS, "wiki/public-note"];
  for (const viewer of ["anonymous", "reader"] as const) {
    const { shown, streamed } = await chat(fixture, viewer);
    // Tool OUTPUTS (what the model learns) and the system prompt: zero markers.
    expect(leaks(JSON.stringify(shown.toolOutputs))).toEqual([]);
    expect(privateSlugs(shown.toolOutputs)).toEqual([]);
    expect(leaks(shown.system)).toEqual([]);
    // The UI stream echoes the model's own tool inputs (here: the tag it asked for),
    // so check the stream for body/title content only.
    expect(leaks(streamed).filter((marker) => marker !== SECRET_TAG)).toEqual([]);
    // Positive control: the public page really was retrievable in this run.
    expect(JSON.stringify(shown.toolOutputs)).toContain("Public");
    // A sensitive page is indistinguishable from a missing one (no existence oracle).
    const outputs = JSON.stringify(shown.toolOutputs);
    expect(outputs).toContain("Page not found");
    expect(outputs).not.toContain('"unavailable"');
  }
});

test("positive control: a role holder does receive the sensitive page through the same tools", async () => {
  const fixture = await createFixture();
  const { shown } = await chat(fixture, "care");
  expect(shown.everything).toContain(SECRET_BODY);
  expect(shown.everything).toContain(SECRET_TITLE);
  // ...but not a sensitive page no role grants.
  expect(shown.everything).not.toContain("no role grants this");
});

test("a signed-in user without the role cannot reach sensitive pages through linked_pages, vector hits or an unprotected sensitive page", async () => {
  const fixture = await createFixture();
  fixture.state.vectorSlugs = [...SECRET_SLUGS, "private/unprotected"];
  const model = scriptedModel([{ name: "read_page", input: { slug: "wiki/links-to-private" } }, { name: "search_wiki", input: { query: SECRET_BODY } }]);
  installModel(model);
  for (const viewer of ["reader", "care"] as const) {
    const response = await handleChatRoute({
      request: jsonRequest("/api/chat", { messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] }] }, cookieFor(fixture, viewer)),
      client: fixture.client, siteSlug: SITE,
    } as never);
    await response.text();
  }
  const outputs = shownToModel(model).toolOutputs;
  // Reader (no role): linked_pages and search hits omit every sensitive page.
  expect(leaks(JSON.stringify(outputs.slice(0, 2)))).toEqual([]);
  expect(privateSlugs(outputs.slice(0, 2))).toEqual([]);
  expect(JSON.stringify(outputs.slice(0, 2))).toContain("wiki/public-note");
  // Care (role): linked_pages and search hits include only the granted pages,
  // never the sensitive page that no role grants.
  const care = outputs.slice(2);
  expect(privateSlugs(care).sort()).toEqual(expect.arrayContaining(SECRET_SLUGS));
  expect(JSON.stringify(outputs)).not.toContain("private/unprotected");
});

test("the app layer drops sensitive vector hits even if the backend ignored includeSensitive", async () => {
  const fixture = await createFixture();
  fixture.state.vectorSlugs = [...SECRET_SLUGS, "private/unprotected", "wiki/public-note"];
  fixture.state.hostileVector = true;
  process.env.OPENAI_API_KEY = "test-key-not-used";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ data: [{ embedding: [0.1, 0.2], index: 0 }], model: "m", object: "list", usage: { prompt_tokens: 1, total_tokens: 1 } })) as never;
  try {
    for (const viewer of ["anonymous", "reader"] as const) {
      const { shown } = await chat(fixture, viewer, [{ name: "search_wiki", input: { query: "something semantic" } }]);
      expect(fixture.state.calls).toBeGreaterThan(0);
      expect(leaks(JSON.stringify(shown.toolOutputs))).toEqual([]);
      expect(JSON.stringify(shown.toolOutputs)).not.toContain("private/unprotected");
      expect(JSON.stringify(shown.toolOutputs)).toContain("wiki/public-note");
    }
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  }
});

test("a sensitive diagnosis/context document is excluded from the system prompt for non-role viewers and included for role holders", async () => {
  const fixture = await createFixture({ sensitiveDiagnosis: true });
  // The fixture's diagnosis document grants nobody (no rule matches it): nobody sees it.
  for (const viewer of ["anonymous", "reader", "care"] as const) {
    const { shown } = await chat(fixture, viewer, [{ name: "list_tags", input: {} }]);
    expect(shown.system).not.toContain("DIAGNOSIS_SENSITIVE_CONTEXT");
    expect(shown.system).not.toContain(SECRET_BODY);
    expect(shown.system).toContain("PAGE_INDEX_PUBLIC");
  }
});

test("the system prompt cache never serves one viewer's access scope to another", async () => {
  const fixture = await createFixture({ sensitiveDiagnosis: true });
  // Grant the care role access to the sensitive diagnosis page.
  await fixture.t.run((ctx) => ctx.db.insert("rolePermissions", { siteId: fixture.ids.siteId, roleId: fixture.ids.role, includePathPatterns: ["wiki/diagnostics/"], createdAt: 2 }));
  const careFirst = await chat(fixture, "care", [{ name: "list_tags", input: {} }]);
  expect(careFirst.shown.system).toContain("DIAGNOSIS_SENSITIVE_CONTEXT");
  for (const viewer of ["reader", "anonymous"] as const) {
    const after = await chat(fixture, viewer, [{ name: "list_tags", input: {} }]);
    expect(after.shown.system).not.toContain("DIAGNOSIS_SENSITIVE_CONTEXT");
  }
});

test("/api/tools returns the same: no sensitive search hits, pages, titles, slugs or tags for non-role viewers", async () => {
  const fixture = await createFixture();
  for (const viewer of ["anonymous", "reader"] as const) {
    const bodies: string[] = [];
    for (const call of ALL_TOOLS) {
      const response = await handleToolsRequest(
        jsonRequest("/api/tools", { tool: call.name, args: call.input }, cookieFor(fixture, viewer)), fixture.client, SITE);
      expect(response.status).toBe(200);
      bodies.push(JSON.stringify(await response.json()));
    }
    expect(leaks(bodies.join("\n"))).toEqual([]);
    expect(privateSlugs(bodies.map((body) => JSON.parse(body)))).toEqual([]);
    expect(bodies.join("\n")).toContain("wiki/public-note");
  }
  // An authorized viewer sees the page in listings and search; /api/tools never
  // returns a sensitive BODY (read_page answers metadata + "unavailable").
  const search = await handleToolsRequest(
    jsonRequest("/api/tools", { tool: "search_wiki", args: { query: SECRET_BODY } }, cookieFor(fixture, "care")), fixture.client, SITE);
  expect(privateSlugs(await search.json()).sort()).toEqual([...SECRET_SLUGS, "private/unprotected"].filter((slug) => slug !== "private/unprotected").sort());
  const read = await handleToolsRequest(
    jsonRequest("/api/tools", { tool: "read_page", args: { slug: "private/care-team-notes" } }, cookieFor(fixture, "care")), fixture.client, SITE);
  expect(await read.json()).toMatchObject({ content: "unavailable", unavailable: true });
});

test("tool outputs apply PII redaction to titles, excerpts and page bodies", async () => {
  const fixture = await createFixture();
  const { shown } = await chat(fixture, "reader", [
    { name: "read_page", input: { slug: "wiki/public-note" } },
    { name: "search_wiki", input: { query: "MRN" } },
  ]);
  const text = JSON.stringify(shown.toolOutputs);
  expect(text).not.toContain("88855655");
  expect(text).toContain("[redacted MRN]");
  expect(shown.system).not.toContain("Diana Laster");
  expect(shown.system).not.toContain("diana.pechter@gmail.com");
});

test("sensitive conversation and chat endpoints sit behind the password gate", async () => {
  const fixture = await createFixture();
  const handler = createWikiApiHandler(fixture.client);
  for (const [path, init] of [
    ["/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) }],
    ["/api/tools", { method: "POST", body: JSON.stringify({ tool: "list_pages" }) }],
    ["/api/wiki/convex-token", { method: "GET" }],
  ] as const) {
    const response = (await handler(new Request(`http://127.0.0.1${path}`, { ...init, headers: { host: "127.0.0.1", "content-type": "application/json" } })))!;
    expect(response.status).toBe(401);
  }
  // The public education fallback is GET-only and never covers chat or tools.
  for (const path of ["/api/education/chat", "/api/education/tools", "/api/education/convex-token"]) {
    const response = await handler(new Request(`http://127.0.0.1${path}`, { headers: { host: "127.0.0.1" } }));
    expect(response === null || response.status === 404).toBe(true);
  }
});

test("revoking a role takes effect on the very next chat: the cached system prompt is not served past the revocation", async () => {
  const fixture = await createFixture({ sensitiveDiagnosis: true });
  await fixture.t.run((ctx) => ctx.db.insert("rolePermissions", { siteId: fixture.ids.siteId, roleId: fixture.ids.role, includePathPatterns: ["wiki/diagnostics/"], createdAt: 2 }));
  const granted = await chat(fixture, "care", [{ name: "list_tags", input: {} }]);
  expect(granted.shown.system).toContain("DIAGNOSIS_SENSITIVE_CONTEXT");
  await fixture.t.run((ctx) => ctx.db.delete(fixture.ids.assignment));
  const revoked = await chat(fixture, "care", [{ name: "list_tags", input: {} }]);
  expect(revoked.shown.system).not.toContain("DIAGNOSIS_SENSITIVE_CONTEXT");
  expect(revoked.shown.system).not.toContain(SECRET_BODY);
});
