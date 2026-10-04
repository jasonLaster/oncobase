import { describe, expect, test } from "bun:test";
import { makePublicWikiSessionIdentity, WIKI_SESSION_CACHE_VERSION, type WikiSessionIdentity } from "@oncobase/wiki-content";
import type { PageContentRow, SiteStateRow } from "../types";
import { keepsPresentationMounted, sessionRouteReady } from "./session-handoff";

const publicIdentity = makePublicWikiSessionIdentity("diana");
const session = (userHash: string, siteSlug = "diana"): WikiSessionIdentity => ({
  siteSlug, scope: "session", authenticated: true, cacheVersion: WIKI_SESSION_CACHE_VERSION,
  cacheKey: `${siteSlug}:session:${userHash}:v1`, userHash,
});

describe("which late identities keep the cached presentation mounted", () => {
  test("only a public page meeting the same site's verified session", () => {
    expect(keepsPresentationMounted(publicIdentity, session("a"))).toBe(true);
  });

  test("another account, session to public, or another site remount", () => {
    expect(keepsPresentationMounted(session("a"), session("b"))).toBe(false);
    expect(keepsPresentationMounted(session("a"), publicIdentity)).toBe(false);
    expect(keepsPresentationMounted(publicIdentity, makePublicWikiSessionIdentity("diana"))).toBe(false);
    expect(keepsPresentationMounted(publicIdentity, session("a", "other-site"))).toBe(false);
  });

  test("never trusts a session label without verified account fields", () => {
    expect(keepsPresentationMounted(publicIdentity, { ...session("a"), authenticated: false })).toBe(false);
    expect(keepsPresentationMounted(publicIdentity, { ...session("a"), userHash: null })).toBe(false);
    expect(keepsPresentationMounted({ ...publicIdentity, authenticated: true }, session("a"))).toBe(false);
  });
});

describe("when the session store can replace the presentation", () => {
  const state = { manifestHash: "m1" } as SiteStateRow;
  const row = (patch: Partial<PageContentRow>) => ({ slug: "wiki/a", content: "", missingAt: null, contentStatus: "fresh", ...patch }) as PageContentRow;

  test("needs a validated manifest and a settled body for the current route", () => {
    expect(sessionRouteReady("wiki/a", row({ content: "# A" }), state)).toBe(true);
    expect(sessionRouteReady("wiki/a", row({ content: "# A" }), null)).toBe(false);
    expect(sessionRouteReady("wiki/a", null, state)).toBe(false);
    expect(sessionRouteReady("wiki/a", row({ content: "" }), state)).toBe(false);
  });

  test("terminal states settle the route; another route's body does not", () => {
    expect(sessionRouteReady("wiki/a", row({ missingAt: 1 }), state)).toBe(true);
    for (const contentStatus of ["deleted", "missing", "sensitive-unavailable"] as const) {
      expect(sessionRouteReady("wiki/a", row({ contentStatus }), state)).toBe(true);
    }
    expect(sessionRouteReady("wiki/a", row({ contentStatus: "stale" }), state)).toBe(false);
    expect(sessionRouteReady("wiki/b", row({ content: "# A" }), state)).toBe(false);
  });
});
