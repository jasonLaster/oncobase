import { expect, test } from "bun:test";
import type { ConvexHttpClient } from "convex/browser";
import type { DataOverlayConfig } from "./config";
import { createHandoffState, verifyHandoffToken } from "./handoff";
import { handleDataOverlayHandoff } from "./main-handoff";

const NOW = 1_800_000_000_000;
const config: DataOverlayConfig = {
  dataOrigin: "https://data.diana-tnbc.com",
  mainOrigin: "https://diana-tnbc.com",
  siteSlug: "diana",
  handoffSecret: "h".repeat(48),
  secureCookies: true,
};
const client = {} as ConvexHttpClient;
const state = createHandoffState();

function call(query: Record<string, string>, { user = null as { _id: string } | null, siteSlug = "diana", overrides = {} as Partial<DataOverlayConfig>, method = "GET" } = {}) {
  const request = new Request(`https://diana-tnbc.com/api/data-overlay/handoff?${new URLSearchParams(query)}`, { method });
  return handleDataOverlayHandoff(request, client, siteSlug, { config: { ...config, ...overrides }, getUser: async () => user, now: () => NOW });
}

test("anonymous visitors are sent to sign in and back", async () => {
  const response = await call({ next: "/private/curefirst/a.pdf", state });
  expect(response.status).toBe(302);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const location = new URL(response.headers.get("location")!, "https://diana-tnbc.com");
  expect(location.pathname).toBe("/sign-in");
  const back = new URL(location.searchParams.get("redirect")!, "https://diana-tnbc.com");
  expect(back.pathname).toBe("/api/data-overlay/handoff");
  expect(back.searchParams.get("next")).toBe("/private/curefirst/a.pdf");
  expect(back.searchParams.get("state")).toBe(state);
});

test("signed-in visitors go to the configured data origin with a 60-second token", async () => {
  const response = await call({ next: "/private/curefirst/a.pdf", state }, { user: { _id: "u1" } });
  expect(response.status).toBe(302);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const location = new URL(response.headers.get("location")!);
  expect(`${location.origin}${location.pathname}`).toBe("https://data.diana-tnbc.com/_auth/callback");
  expect(location.searchParams.get("next")).toBe("/private/curefirst/a.pdf");
  const claims = verifyHandoffToken(location.searchParams.get("token"), { secret: config.handoffSecret, site: "diana", aud: config.dataOrigin, state, nowMs: NOW });
  expect(claims).toMatchObject({ sub: "u1", exp: NOW / 1000 + 60 });
  expect(verifyHandoffToken(location.searchParams.get("token"), { secret: config.handoffSecret, site: "diana", aud: config.dataOrigin, state, nowMs: NOW + 60_000 })).toBeNull();
});

test("unsafe destinations collapse to the data index", async () => {
  for (const next of ["https://evil.example", "//evil.example", "/../private/x", "/_auth/callback"]) {
    const response = await call({ next, state }, { user: { _id: "u1" } });
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://data.diana-tnbc.com");
    expect(location.searchParams.get("next")).toBe("/");
  }
});

test("other sites, bad state, missing secret and other methods are refused", async () => {
  expect((await call({ next: "/", state }, { user: { _id: "u1" }, siteSlug: "other" })).status).toBe(404);
  expect((await call({ next: "/", state: "short" }, { user: { _id: "u1" } })).status).toBe(400);
  expect((await call({ next: "/" }, { user: { _id: "u1" } })).status).toBe(400);
  expect((await call({ next: "/", state }, { user: { _id: "u1" }, overrides: { handoffSecret: null } })).status).toBe(503);
  expect((await call({ next: "/", state }, { user: { _id: "u1" }, overrides: { handoffSecret: "short" } })).status).toBe(503);
  expect((await call({ next: "/", state }, { user: { _id: "u1" }, method: "POST" })).status).toBe(405);
});
