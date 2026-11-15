import { afterEach, expect, test } from "bun:test";
import { takeEarlyResponse } from "./early-requests";

const globals = globalThis as unknown as { window?: unknown; location?: unknown };
const saved = { window: globals.window, location: globals.location };
afterEach(() => { globals.window = saved.window; globals.location = saved.location; });

function install(responses: Record<string, Promise<Response>>) {
  globals.location = new URL("https://wiki.example/wiki/a");
  globals.window = { __WIKI_EARLY__: { responses, startedAt: Object.fromEntries(Object.keys(responses).map(key => [key, performance.now()])) } };
}

test("a versioned page read takes the head script's unversioned early response (P11)", () => {
  const early = Promise.resolve(new Response("{}"));
  install({ "/api/wiki/pages?scope=session&slugs=wiki%2Fa": early });
  const taken = takeEarlyResponse("/api/wiki/pages?scope=session&slugs=wiki%2Fa&v=h1");
  expect(taken?.response).toBe(early);
  expect(takeEarlyResponse("/api/wiki/pages?scope=session&slugs=wiki%2Fa")).toBeUndefined();
});

test("an exact early match still wins and other slugs do not match", () => {
  const exact = Promise.resolve(new Response("exact"));
  install({ "/api/wiki/pages?scope=session&slugs=wiki%2Fa&v=h1": exact });
  expect(takeEarlyResponse("/api/wiki/pages?scope=session&slugs=wiki%2Fb&v=h1")).toBeUndefined();
  expect(takeEarlyResponse("/api/wiki/pages?scope=session&slugs=wiki%2Fa&v=h1")?.response).toBe(exact);
});
