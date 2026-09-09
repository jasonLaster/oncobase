import { expect, test } from "bun:test";
import { fetchWikiConvexToken } from "./convex-token";

const responding = (response: Response) => async () => response;

test("returns the token with session credentials and no caching", async () => {
  let request: unknown;
  const token = await fetchWikiConvexToken(async (url, options) => {
    request = { url, options };
    return Response.json({ token: "fixture-token" });
  });
  expect(token).toBe("fixture-token");
  expect(request).toEqual({ url: "/api/wiki/convex-token", options: { credentials: "same-origin", cache: "no-store" } });
});

test("a canceled request resolves to an unavailable token", async () => {
  await expect(fetchWikiConvexToken(async () => {
    throw new TypeError("Load failed");
  })).resolves.toBeNull();
});

test("a canceled response body resolves to an unavailable token", async () => {
  const response = new Response(new ReadableStream({
    start(controller) { controller.error(new DOMException("Navigation canceled the body", "AbortError")); },
  }));
  await expect(fetchWikiConvexToken(responding(response))).resolves.toBeNull();
});

test("a later auth attempt succeeds after a temporary network failure", async () => {
  let attempts = 0;
  const fetchToken = async () => {
    if (++attempts === 1) throw new TypeError("Load failed");
    return Response.json({ token: "new-fixture-token" });
  };
  expect(await fetchWikiConvexToken(fetchToken)).toBeNull();
  expect(await fetchWikiConvexToken(fetchToken)).toBe("new-fixture-token");
});

test("failed responses and missing or malformed tokens are unavailable", async () => {
  for (const response of [new Response("unavailable", { status: 503 }), Response.json({}), Response.json(null), Response.json({ token: 42 }), new Response("invalid json")]) {
    expect(await fetchWikiConvexToken(responding(response))).toBeNull();
  }
});
