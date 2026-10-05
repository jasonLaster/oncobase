// Other routes that can carry page content must not hand sensitive pages to a
// viewer without a grant: copy-as-markdown, search, AI search and link previews.
import { expect, test } from "bun:test";
import type { generateText } from "ai";
import { api } from "../convex/_generated/api";
import { handleAiSearchRequest } from "./ai-search";
import { handlePageCopyRequest } from "./api/page-copy";
import { handleSearchRequest } from "./api/search";
import { handleSharePreviewRequest } from "./api/share-preview";
import { PUBLIC_NEEDLE, SECRET_BODY, SECRET_TITLE, SITE, cookieFor, createFixture, jsonRequest, type Viewer } from "./chat-security-fixture";

const get = (fixture: Awaited<ReturnType<typeof createFixture>>, viewer: Viewer, path: string) =>
  new Request(`http://127.0.0.1${path}`, { headers: { host: "127.0.0.1", cookie: cookieFor(fixture, viewer) } });

test("page copy returns a sensitive page only to a viewer who can read it, as a 404 otherwise", async () => {
  const fixture = await createFixture();
  const copy = (viewer: Viewer, slug: string, scope = "") =>
    handlePageCopyRequest(get(fixture, viewer, `/api/page-copy?slug=${encodeURIComponent(slug)}${scope}`), fixture.client, SITE);
  for (const viewer of ["anonymous", "reader"] as const) {
    expect((await copy(viewer, "private/care-team-notes")).status).toBe(404);
  }
  expect((await copy("care", "private/unprotected")).status).toBe(404);
  const care = await copy("care", "private/care-team-notes");
  expect(care.status).toBe(200);
  expect(await care.text()).toContain(SECRET_BODY);
  expect(care.headers.get("cache-control")).toContain("private");
  // The public scope never serves sensitive pages, even to a role holder.
  expect((await copy("care", "private/care-team-notes", "&scope=public")).status).toBe(404);
  // Public pages are redacted before they are copied.
  expect(await (await copy("anonymous", "wiki/public-note")).text()).not.toContain("88855655");
});

test("link previews expose no title or description of a sensitive page", async () => {
  const fixture = await createFixture();
  for (const viewer of ["anonymous", "reader", "care"] as const) {
    const response = await handleSharePreviewRequest(get(fixture, viewer, "/api/share-preview?path=/private/care-team-notes"), fixture.client, SITE);
    const html = await response.text();
    expect(html).not.toContain(SECRET_TITLE);
    expect(html).not.toContain(SECRET_BODY);
  }
});

test("text search never returns sensitive hits to a viewer without a grant", async () => {
  const fixture = await createFixture();
  const search = async (viewer: Viewer) => {
    const response = await handleSearchRequest(get(fixture, viewer, `/api/search?q=${PUBLIC_NEEDLE}&scope=session`), fixture.client, SITE, false);
    return await response.text();
  };
  for (const viewer of ["anonymous", "reader"] as const) {
    const body = await search(viewer);
    expect(body).not.toContain(SECRET_BODY);
    expect(body).not.toContain(SECRET_TITLE);
    expect(body).not.toContain("private/");
  }
});

test("AI search never scores or summarizes a sensitive page for a viewer without a grant, even when the caller names its slug", async () => {
  const fixture = await createFixture();
  for (const viewer of ["anonymous", "reader"] as const) {
    const prompts: string[] = [];
    const generate = (async ({ prompt }: { prompt: string }) => { prompts.push(prompt); return { output: { relevance: 9, summary: "relevant" } }; }) as unknown as typeof generateText;
    const response = await handleAiSearchRequest({
      request: jsonRequest("/api/ai-search?scope=session", { query: PUBLIC_NEEDLE, slugs: ["private/care-team-notes", "private/family-contacts", "wiki/public-note"] }, cookieFor(fixture, viewer)),
      client: fixture.client, siteSlug: SITE, includeSensitive: viewer !== "anonymous",
      allowedSensitiveSlugs: async (slugs) => {
        if (viewer === "anonymous") return new Set();
        const rows = await fixture.service.query(api.access.filterAccessibleSlugs, { siteSlug: SITE, userId: fixture.ids.reader, slugs });
        return new Set(rows.filter((row) => row.allowed).map((row) => row.slug));
      },
      generate,
    });
    const body = await response.text();
    expect(body).not.toContain("private/");
    expect(body).not.toContain(SECRET_TITLE);
    expect(prompts.join("\n")).not.toContain(SECRET_BODY);
    expect(prompts.join("\n")).not.toContain(SECRET_TITLE);
    expect(prompts.length).toBeGreaterThan(0);
  }
});
