import { expect, test } from "bun:test";
import { matchApiRoute } from "./api-routes";

const offer = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";

test("the page talk route sits behind the password gate", () => {
  expect(matchApiRoute("/api/wiki/talk")).toMatchObject({ path: "/api/wiki/talk", gate: "required" });
});

test("opens a call with the page-talk session, from the reader's own origin only", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.ONCOBASE_TALK_OPENAI_API_KEY;
  process.env.ONCOBASE_TALK_OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("v=0 answer", { status: 201, headers: { "Content-Type": "application/sdp" } });
  }) as typeof fetch;
  try {
    const { handlePageTalk, PAGE_TALK_PROMPT, PAGE_TALK_TOOLS } = await import("./api/page-talk");
    const post = (origin: string) => handlePageTalk(new Request("https://diana-tnbc.com/api/wiki/talk", {
      method: "POST", body: offer, headers: { "Content-Type": "application/sdp", Origin: origin, "X-Forwarded-For": "2.2.2.2" },
    }));
    expect((await post("https://oncoguide.cc")).status).toBe(403);
    expect(calls).toHaveLength(0);
    const response = await post("https://diana-tnbc.com");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("v=0 answer");
    const session = JSON.parse(String((calls[0]!.init.body as FormData).get("session")));
    expect(session.instructions).toBe(PAGE_TALK_PROMPT);
    expect(session.tools).toEqual(JSON.parse(JSON.stringify(PAGE_TALK_TOOLS)));
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ONCOBASE_TALK_OPENAI_API_KEY;
    else process.env.ONCOBASE_TALK_OPENAI_API_KEY = previousKey;
  }
});
