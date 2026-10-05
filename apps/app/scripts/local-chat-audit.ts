import { ConvexHttpClient } from "convex/browser";
import { createBackendClient } from "../server/backend-client.ts";
import { documentsGateway } from "../server/chat-route.ts";
import { canUserAccessSlug } from "../server/reader-access.ts";
import { api } from "../convex/_generated/api.js";

// Chat access audit against a running local stack (bun run local:chat-audit).
// Verifies (a) no principal can reach sensitive pages through the model's data
// tools and (b) a viewer's conversations are invisible to every other viewer,
// including server calls that forget to name an owner.
const SITE = "diana", SENSITIVE = "private/care-team-notes", ORIGIN = process.env.AUDIT_ORIGIN ?? `http://127.0.0.1:${process.env.LOCAL_STACK_APP_PORT ?? 62003}`;
const gatePw = process.env.LOCAL_STACK_GATE_PASSWORD!;
const users = {
  care: { email: process.env.LOCAL_STACK_CARE_EMAIL!, password: process.env.LOCAL_STACK_CARE_PASSWORD! },
  reader: { email: process.env.LOCAL_STACK_READER_EMAIL!, password: process.env.LOCAL_STACK_READER_PASSWORD! },
};
let failures = 0;
const expect = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures++; };
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().map(c => c.split(";")[0]!).find(c => c.startsWith(name + "="));
const post = (path: string, body: unknown, cookie = "") => fetch(ORIGIN + path, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });

const gate = cookieOf(await post("/api/login", { password: gatePw }), "authed")!;
const session: Record<string, { cookie: string; id: string }> = {};
for (const [k, u] of Object.entries(users)) {
  const res = await post("/api/auth/signin", u, gate);
  const c = `${gate}; ${cookieOf(res, "wiki_user_session")}`;
  const who = await (await fetch(ORIGIN + "/api/auth/session", { headers: { cookie: c } })).json() as any;
  session[k] = { cookie: c, id: who.user._id };
}

// ---- (a) what each principal's chat tools can reach -------------------------------
const server = createBackendClient();
const principals = {
  anonymous: { include: false, can: undefined as undefined | ((s: string) => Promise<boolean>) },
  reader: { include: true, can: (s: string) => canUserAccessSlug(server, SITE, { _id: session.reader!.id } as any, s) },
  care: { include: true, can: (s: string) => canUserAccessSlug(server, SITE, { _id: session.care!.id } as any, s) },
};
for (const [name, p] of Object.entries(principals)) {
  const g = documentsGateway(server as any, SITE, p.include, p.can);
  const shouldSee = name === "care";
  const slugs = (rows: any[]) => rows.map(r => r.slug);
  expect(slugs(await g.search({ query: "sensitive", limit: 20 })).includes(SENSITIVE) === shouldSee, `${name}: search_wiki ${shouldSee ? "finds" : "never returns"} the sensitive page`);
  expect(((await g.getBySlug({ slug: SENSITIVE }))?.slug === SENSITIVE) === shouldSee, `${name}: read_page ${shouldSee ? "reads" : "is denied"} the sensitive page`);
  expect(((await g.getBySlug({ slug: SENSITIVE, includeSensitive: true }))?.slug === SENSITIVE) === shouldSee, `${name}: model-supplied includeSensitive:true ${shouldSee ? "works for the care team" : "cannot bypass the check"}`);
  expect(slugs(await g.list()).includes(SENSITIVE) === shouldSee, `${name}: list_pages ${shouldSee ? "includes" : "excludes"} the sensitive page`);
  expect(slugs(await g.getByTag({ tag: "sensitive" })).includes(SENSITIVE) === shouldSee, `${name}: get_pages_by_tag("sensitive") ${shouldSee ? "includes" : "excludes"} it`);
  const tags = await g.listTags();
  expect(tags.includes("care-team") === shouldSee, `${name}: list_tags ${shouldSee ? "includes" : "hides"} tags only used by sensitive pages`);
  expect(slugs(await g.vectorSearch({ embedding: new Array(1536).fill(0.01), limit: 20 })).includes(SENSITIVE) === false || shouldSee, `${name}: vector search never returns the sensitive page to a non-owner`);
}

// ---- (b) conversations created by one viewer are invisible to others ------------------
const tokenFor = async (cookie: string) => (await (await fetch(ORIGIN + "/api/wiki/convex-token", { headers: { cookie } })).json() as any).token as string;
const convex = (token: string) => { const c = new ConvexHttpClient(process.env.CONVEX_URL!); c.setAuth(token); return c; };
const careConvex = convex(await tokenFor(session.care!.cookie));
const readerConvex = convex(await tokenFor(session.reader!.cookie));
const anonConvex = convex(await tokenFor(gate)); // gate-only: anonymous owner cookie is minted by the endpoint
const created = await careConvex.mutation(api.conversations.create, { siteSlug: SITE, title: "AUDIT: contains care-team data" } as any) as any;
const convId = typeof created === "string" ? created : created._id ?? created.id;
const listIds = async (c: ConvexHttpClient) => ((await c.query(api.conversations.list, { siteSlug: SITE } as any)) as any[]).map(r => r._id);
expect((await listIds(careConvex)).includes(convId), "care: sees own conversation");
expect(!(await listIds(readerConvex)).includes(convId), "other signed-in user: cannot list it");
expect(!(await listIds(anonConvex)).includes(convId), "gate-only/anonymous viewer: cannot list it");
const tryCall = async (fn: () => Promise<unknown>) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, value: String(e).slice(0, 80) }; } };
for (const [name, c] of [["other signed-in user", readerConvex], ["anonymous viewer", anonConvex]] as const) {
  const got = await tryCall(() => c.query(api.conversations.get, { id: convId, siteSlug: SITE } as any));
  expect(!got.ok || got.value == null, `${name}: get(conversation) is denied or empty`);
  const withForgedOwner = await tryCall(() => c.query(api.conversations.get, { id: convId, siteSlug: SITE, ownerKey: "0".repeat(64) } as any));
  expect(!withForgedOwner.ok || withForgedOwner.value == null, `${name}: supplying an ownerKey argument does not widen access`);
  const removed = await tryCall(() => c.mutation(api.conversations.remove, { id: convId, siteSlug: SITE } as any));
  void removed; // outcome is asserted below: the owner's conversation must still exist
}
expect((await listIds(careConvex)).includes(convId), "care: conversation survives the other viewers' delete attempts");
// The server's own identity must name an owner: no site-wide view of conversations.
const noOwner = await tryCall(() => server.query(api.conversations.list, { siteSlug: SITE } as any));
expect(!noOwner.ok, "server call without an ownerKey is rejected (fails closed)");
const otherOwner = await tryCall(() => server.query(api.conversations.get, { id: convId, siteSlug: SITE, ownerKey: "b".repeat(64) } as any));
expect(!otherOwner.ok || otherOwner.value == null, "server call as a different owner cannot read the conversation");
await careConvex.mutation(api.conversations.remove, { id: convId, siteSlug: SITE } as any).catch(() => {});
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall audit checks passed");
process.exit(failures ? 1 : 0);
