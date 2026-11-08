import { expect, test } from "bun:test";
import { EDUCATION_TALK_PROMPT, TALK_MODEL } from "@oncobase/education/talk";
import { createEducationTalkHandler } from "./education-talk";

const offer = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
const request = ({ origin = "https://oncoguide.cc" as string | null, body = offer, type = "application/sdp", method = "POST", ip = "1.1.1.1" } = {}) =>
  new Request("https://diana-tnbc.com/api/education/talk", {
    method, body: method === "POST" ? body : undefined,
    headers: { "Content-Type": type, "X-Forwarded-For": ip, ...(origin ? { Origin: origin } : {}) },
  });
function harness(response: () => Response = () => new Response("v=0 answer", { status: 201, headers: { "Content-Type": "application/sdp", Location: "/v1/realtime/calls/rtc_1" } }), options: Parameters<typeof createEducationTalkHandler>[0] = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const handler = createEducationTalkHandler({
    apiKey: () => "sk-test", allowedOrigins: ["https://oncoguide.cc"],
    fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return response(); }) as typeof fetch,
    ...options,
  });
  return { handler, calls };
}

test("relays the offer with a server-defined session and returns only the answer", async () => {
  const { handler, calls } = harness();
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("v=0 answer");
  expect(response.headers.get("content-type")).toBe("application/sdp");
  expect(response.headers.get("access-control-allow-origin")).toBe("https://oncoguide.cc");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  // The provider's call URL stays private to the server.
  expect(response.headers.get("location")).toBeNull();

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://api.openai.com/v1/realtime/calls");
  expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer sk-test");
  const form = calls[0]!.init.body as FormData;
  expect(form.get("sdp")).toBe(offer);
  const session = JSON.parse(String(form.get("session")));
  expect(session.type).toBe("realtime");
  expect(session.model).toBe(TALK_MODEL);
  expect(session.instructions).toBe(EDUCATION_TALK_PROMPT);
  expect(session.tools.map((tool: { name: string }) => tool.name)).toEqual(["search_education", "read_section", "lesson_sections", "suggest_page", "open_page", "dismiss_suggestion"]);
});

test("stays off without its dedicated key, before any upstream work", async () => {
  const { handler, calls } = harness(undefined, { apiKey: () => undefined });
  const response = await handler(request());
  expect(response.status).toBe(503);
  expect(calls).toHaveLength(0);
});

test("refuses other origins, missing origins, wrong types and malformed offers", async () => {
  const { handler, calls } = harness();
  expect((await handler(request({ origin: "https://attacker.test" }))).status).toBe(403);
  expect((await handler(request({ origin: null }))).status).toBe(403);
  expect((await handler(request({ type: "application/json" }))).status).toBe(415);
  expect((await handler(request({ body: "hello" }))).status).toBe(400);
  expect((await handler(request({ body: `v=0${"x".repeat(70_000)}` }))).status).toBe(400);
  expect((await handler(request({ method: "GET" }))).status).toBe(405);
  expect(calls).toHaveLength(0);
});

test("preflight allows the SDP content type and does no upstream work", async () => {
  const { handler, calls } = harness();
  const response = await handler(request({ method: "OPTIONS" }));
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
  expect(response.headers.get("access-control-allow-origin")).toBe("https://oncoguide.cc");
  expect(calls).toHaveLength(0);
});

test("limits calls per client and overall", async () => {
  const perClient = harness(undefined, { perClientLimit: 1 });
  expect((await perClient.handler(request())).status).toBe(200);
  expect((await perClient.handler(request())).status).toBe(429);
  expect((await perClient.handler(request({ ip: "2.2.2.2" }))).status).toBe(200);
  expect(perClient.calls).toHaveLength(2);

  const overall = harness(undefined, { overallLimit: 1 });
  expect((await overall.handler(request())).status).toBe(200);
  const limited = await overall.handler(request({ ip: "2.2.2.2" }));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("600");

  const abuse = harness(undefined, { perClientLimit: 1, overallLimit: 2 });
  for (let attempt = 0; attempt < 5; attempt++) await abuse.handler(request());
  expect((await abuse.handler(request({ ip: "2.2.2.2" }))).status).toBe(200);
});

test("hides provider errors from readers", async () => {
  const refused = await harness(() => Response.json({ error: { code: "invalid_api_key", message: "Incorrect key sk-test" } }, { status: 401 })).handler(request());
  expect(refused.status).toBe(502);
  expect(await refused.text()).not.toContain("sk-test");
  expect((await harness(() => Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 })).handler(request())).status).toBe(429);
  const thrown = await harness(() => { throw Error("socket hang up"); }).handler(request());
  expect(thrown.status).toBe(502);
  expect(await thrown.text()).not.toContain("socket");
});
