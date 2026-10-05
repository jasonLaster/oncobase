// Comment threads on a sensitive page are as sensitive as the page. Liveblocks
// is replaced by an in-memory double; the real comment handlers and Convex
// access rules run.
import { beforeAll, expect, mock, test } from "bun:test";
import { SITE, cookieFor, createFixture, jsonRequest, type Fixture, type Viewer } from "./chat-security-fixture";

type Call = { op: string; args: unknown };
const calls: Call[] = [];
const ROOMS = ["markdown:wiki/public-note", "markdown:private/care-team-notes", "markdown:private/unprotected", "other-room"];
const SECRET_COMMENT = "SECRET_COMMENT_MARKER_55aa";
const thread = (roomId: string) => ({
  id: `th-${roomId}`, roomId, createdAt: new Date(1), updatedAt: new Date(2), resolved: false, metadata: {},
  comments: [{ id: `c-${roomId}`, userId: "guest:x", createdAt: new Date(1), body: { version: 1, content: [{ type: "paragraph", children: [{ text: `${SECRET_COMMENT} in ${roomId}` }] }] } }],
});

mock.module("@liveblocks/node", () => ({
  WebhookHandler: class {},
  Liveblocks: class {
    async getRooms() { return { data: ROOMS.map((id) => ({ id })), nextCursor: null }; }
    async getThreads({ roomId }: { roomId: string }) { return { data: [thread(roomId)] }; }
    async createComment(args: unknown) { calls.push({ op: "createComment", args }); return { id: "new" }; }
    async deleteThread(args: unknown) { calls.push({ op: "deleteThread", args }); }
    prepareSession(userId: string) {
      const allowed: Array<[string, unknown]> = [];
      return {
        FULL_ACCESS: ["room:write"], READ_ACCESS: ["room:read"],
        allow(room: string, access: unknown) { allowed.push([room, access]); },
        async authorize() { calls.push({ op: "authorize", args: { userId, allowed } }); return { status: 200, body: JSON.stringify({ token: "t", allowed }) }; },
      };
    }
  },
}));

let comments: typeof import("./api/comments");
beforeAll(async () => {
  process.env.LIVEBLOCKS_SECRET_KEY = "sk_test_fixture";
  delete process.env.NEXT_PUBLIC_ENABLE_COMMENTS;
  comments = await import("./api/comments");
});

const get = (fixture: Fixture, viewer: Viewer, path: string) =>
  new Request(`http://127.0.0.1${path}?fresh=1`, { headers: { host: "127.0.0.1", cookie: cookieFor(fixture, viewer) } });

test("thread listing never returns comments from sensitive pages the viewer cannot read", async () => {
  const fixture = await createFixture({ passwordGate: false, enableComments: true });
  const listed = async (viewer: Viewer) => {
    comments.liveblocksThreadsResponseCache.clear();
    const response = await comments.handleLiveblocksThreadsRequest(get(fixture, viewer, "/api/liveblocks-threads"), fixture.client, SITE);
    expect(response.status).toBe(200);
    return ((await response.json()) as { threads: Array<{ roomId: string }> }).threads.map((t) => t.roomId).sort();
  };
  expect(await listed("anonymous")).toEqual(["markdown:wiki/public-note", "other-room"]);
  // Signed in without a role: same as anonymous. (A session is not a grant.)
  expect(await listed("reader")).toEqual(["markdown:wiki/public-note", "other-room"]);
  // Care team: also the pages a role grants, but not a sensitive page no role grants.
  expect(await listed("care")).toEqual(["markdown:private/care-team-notes", "markdown:wiki/public-note", "other-room"]);
});

test("the cached thread listing of one signed-in viewer is never served to another", async () => {
  const fixture = await createFixture({ passwordGate: false, enableComments: true });
  comments.liveblocksThreadsResponseCache.clear();
  const warm = await comments.handleLiveblocksThreadsRequest(new Request("http://127.0.0.1/api/liveblocks-threads", { headers: { host: "127.0.0.1", cookie: cookieFor(fixture, "care") } }), fixture.client, SITE);
  expect(JSON.stringify(await warm.json())).toContain(SECRET_COMMENT);
  const reader = await comments.handleLiveblocksThreadsRequest(new Request("http://127.0.0.1/api/liveblocks-threads", { headers: { host: "127.0.0.1", cookie: cookieFor(fixture, "reader") } }), fixture.client, SITE);
  expect(JSON.stringify(await reader.json())).not.toContain("private/");
});

test("a room token for a sensitive page is only issued to a viewer who can read the page", async () => {
  const fixture = await createFixture({ passwordGate: false, enableComments: true });
  const auth = async (viewer: Viewer, room: string) => {
    calls.length = 0;
    const response = await comments.handleLiveblocksAuthRequest(jsonRequest("/api/liveblocks-auth", { room }, cookieFor(fixture, viewer)), fixture.client, SITE);
    return { status: response.status, authorized: calls.some((call) => call.op === "authorize") };
  };
  for (const viewer of ["anonymous", "reader"] as const) {
    expect(await auth(viewer, "markdown:private/care-team-notes")).toEqual({ status: 404, authorized: false });
  }
  expect(await auth("care", "markdown:private/unprotected")).toEqual({ status: 404, authorized: false });
  expect(await auth("care", "markdown:private/care-team-notes")).toEqual({ status: 200, authorized: true });
  expect(await auth("reader", "markdown:wiki/public-note")).toEqual({ status: 200, authorized: true });
});

test("commenting on or deleting threads of a sensitive page requires access to the page", async () => {
  const fixture = await createFixture({ passwordGate: false, enableComments: true });
  const body = { roomId: "markdown:private/care-team-notes", threadId: "th-1", body: "hello" };
  for (const [handler, extra] of [[comments.handleLiveblocksAddCommentRequest, "createComment"], [comments.handleLiveblocksDeleteThreadRequest, "deleteThread"]] as const) {
    calls.length = 0;
    const denied = await handler(jsonRequest("/x", body, cookieFor(fixture, "reader")), fixture.client, SITE);
    expect(denied.status, extra).toBe(404);
    expect(calls.some((call) => call.op === extra), extra).toBe(false);
    const allowed = await handler(jsonRequest("/x", body, cookieFor(fixture, "care")), fixture.client, SITE);
    expect(allowed.status, extra).toBe(200);
    expect(calls.some((call) => call.op === extra), extra).toBe(true);
  }
});
