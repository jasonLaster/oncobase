import { expect, test } from "@playwright/test";
import {
  anonymousContext,
  assertPrivate,
  gateCookie,
  GATE_PASSWORD,
  requireLocalStack,
  runsAgainstPreview,
  signedInContext,
} from "./helpers";

// Route x auth-state, request-only. Replaces auth-gate-security,
// preview-e2e/auth-gate and the gate halves of backend-api / sidebar-pdfs.
// Every cell asserts status AND the cache headers: a shared cache holding any
// of these answers would leak one visitor's identity to the next.
requireLocalStack();

const CARE = { email: "care@local.test", password: "local-care-password" };
const READER = { email: "reader@local.test", password: "local-reader-password" };
const INSURANCE = "wiki/logistics/insurance";
const PRIVATE = "private/care-team-notes";
const GATE_REQUIRED = { error: "Password gate authentication required" };

type Row = {
  path: string;
  method?: "GET" | "POST";
  data?: unknown;
  /** Expected status for [anonymous, forged cookie, gate cookie]. */
  status: [number, number, number];
  /** POST handlers set cache headers only on the gate's refusal; success bodies are never cacheable anyway. */
  postHandler?: boolean;
  /** Responses that carry no identity-dependent Vary. */
  noVary?: boolean;
  /** Session-scope refusals are not the gate's own 401. */
  sessionRefusal?: boolean;
};

const ROWS: Row[] = [
  { path: "/api/wiki/session", status: [200, 200, 200] },
  { path: "/api/auth/session", status: [200, 200, 200] },
  // Anonymous reads of these two come from the public education library only.
  { path: "/api/wiki/manifest", status: [200, 200, 200] },
  { path: "/api/search?q=diagnosis", status: [200, 200, 200] },
  { path: `/api/wiki/pages?slugs=${INSURANCE}`, status: [401, 401, 200] },
  { path: `/api/page-copy?slug=${INSURANCE}`, status: [401, 401, 200] },
  { path: "/api/download?type=markdown", status: [401, 401, 200] },
  { path: "/api/file?path=wiki/logistics/insurance-card.pdf", status: [401, 401, 200] },
  { path: "/api/tools", method: "POST", data: { tool: "list_tags", args: {} }, status: [401, 401, 200], postHandler: true },
  { path: "/api/chat", method: "POST", data: { messages: [] }, status: [401, 401, 400], postHandler: true },
  { path: "/api/ai-search", method: "POST", data: { query: "" }, status: [401, 401, 200], postHandler: true },
  // Session scope needs an account; a gate cookie alone is not one.
  { path: `/api/wiki/pages?scope=session&slugs=${PRIVATE}`, status: [401, 401, 401], sessionRefusal: true },
  { path: "/api/search?q=diagnosis&scope=session", status: [401, 401, 401], sessionRefusal: true },
  { path: "/api/wiki/session?scope=session", status: [401, 401, 401], sessionRefusal: true, noVary: true },
];

test("API routes answer each auth state with the right status and never a shared-cache header", async ({ baseURL }) => {
  const cookie = await gateCookie(baseURL!);
  const states = [
    ["anonymous", {}],
    ["forged cookie", { Cookie: "authed=true" }],
    ["gate cookie", { Cookie: cookie }],
  ] as const;
  const failures: string[] = [];

  for (const [index, [state, headers]] of states.entries()) {
    const context = await anonymousContext(baseURL!, headers);
    try {
      for (const row of ROWS) {
        const response = await context.fetch(row.path, { method: row.method ?? "GET", data: row.data });
        const label = `${state} ${row.method ?? "GET"} ${row.path}`;
        if (response.status() !== row.status[index]) {
          failures.push(`${label}: ${response.status()} !== ${row.status[index]}`);
          continue;
        }
        if (response.status() === 401 || !row.postHandler) assertPrivate(response, label, !row.noVary);
        if (response.status() === 401 && !row.sessionRefusal) {
          expect(await response.json(), label).toEqual(GATE_REQUIRED);
          expect(response.headers().vary, label).toContain("Host");
        }
        if (response.status() === 401 && row.sessionRefusal && state === "gate cookie") {
          expect(JSON.stringify(await response.json()), label).toContain("Session scope requires a signed-in wiki session");
        }
      }
    } finally {
      await context.dispose();
    }
  }
  expect(failures).toEqual([]);

  // Anonymous and forged-cookie reads of the content-shaped endpoints expose
  // nothing but the education library; the gate cookie sees the real site.
  for (const [state, headers] of states) {
    const context = await anonymousContext(baseURL!, headers);
    try {
      const manifest = (await (await context.get("/api/wiki/manifest")).json()) as { pages: Array<{ slug: string }> };
      const search = (await (await context.get("/api/search?q=diagnosis")).json()) as { results: Array<{ slug: string }> };
      const slugs = [...manifest.pages, ...search.results].map((page) => page.slug.toLowerCase());
      if (state === "gate cookie") {
        expect(manifest.pages.map((page) => page.slug), "gate cookie sees the site").toContain(INSURANCE);
        expect(search.results.length, "gate cookie search").toBeGreaterThan(0);
      } else {
        expect(slugs.filter((slug) => !slug.startsWith("wiki/education/")), `${state} leaks non-education pages`).toEqual([]);
      }
    } finally {
      await context.dispose();
    }
  }
});

test("signed-in sessions: identity is private, and session-scope pages follow the account", async ({ baseURL }) => {
  const care = await signedInContext(baseURL!, CARE);
  const reader = await signedInContext(baseURL!, READER);
  try {
    for (const [name, context, email] of [["care", care, CARE.email], ["reader", reader, READER.email]] as const) {
      const session = await context.get("/api/wiki/session?scope=session");
      assertPrivate(session, `${name} session`, false);
      expect(session.headers()["x-wiki-cache-scope"], name).toBe("session");
      const body = await session.json();
      expect(body).toMatchObject({ siteSlug: "diana", scope: "session", authenticated: true });
      expect(body.cacheKey, name).toContain("session");
      expect((await (await context.get("/api/auth/session")).json()).user.email, name).toBe(email);
    }

    const url = `/api/wiki/pages?scope=session&slugs=${PRIVATE}`;
    const granted = await care.get(url);
    assertPrivate(granted, "care private page");
    expect((await granted.json()).pages[0].content).toContain("Next oncology visit");

    const denied = await reader.get(url);
    assertPrivate(denied, "reader private page");
    expect(await denied.json()).toMatchObject({ pages: [], unavailable: [{ slug: PRIVATE, reason: "sensitive-unavailable" }] });

    // Signing out drops the identity from the very next request on the same cookie jar.
    expect((await care.post("/api/auth/signout")).ok()).toBeTruthy();
    expect((await (await care.get("/api/auth/session")).json()).user).toBeNull();
    const afterSignOut = await care.get(url);
    expect(afterSignOut.status()).toBe(401);
    expect(JSON.stringify(await afterSignOut.json())).not.toContain("Next oncology visit");
  } finally {
    await Promise.all([care.dispose(), reader.dispose()]);
  }
});

test("HTML routes: the bare domain is the landing page, private links go to sign-in, all uncached", async ({ baseURL }) => {
  test.skip(!runsAgainstPreview, "The HTML password gate is owned by the standalone/Vercel server, not the Vite dev server.");
  const origin = new URL(baseURL!).origin;
  const cookie = await gateCookie(baseURL!);
  const expectPrivateHtml = (response: Awaited<ReturnType<Awaited<ReturnType<typeof anonymousContext>>["get"]>>, label: string) => {
    expect(response.headers()["cache-control"], label).toBe("private, no-store");
    expect(response.headers().vary, label).toContain("Cookie");
    expect(response.headers().vary, label).toContain("Host");
  };

  for (const [state, headers] of [["anonymous", {}], ["forged cookie", { Cookie: "authed=true" }]] as const) {
    const context = await anonymousContext(baseURL!, headers);
    try {
      const root = await context.get("/", { maxRedirects: 0 });
      expect(root.status(), `${state} /`).toBe(200);
      expect(await root.text(), `${state} /`).toContain('name="wiki-reader-access" content="landing"');
      expectPrivateHtml(root, `${state} /`);
      for (const path of [`/${INSURANCE}`, "/tissue-plan.html", "/tissue-plan.html?download=1"]) {
        const response = await context.get(path, { maxRedirects: 0 });
        expect(response.status(), `${state} ${path}`).toBe(302);
        const location = new URL(response.headers().location, origin);
        expect(location.pathname, `${state} ${path}`).toBe("/sign-in");
        if (!path.includes(".html")) expect(location.searchParams.get("redirect")).toBe(path);
        expectPrivateHtml(response, `${state} ${path}`);
      }
    } finally {
      await context.dispose();
    }
  }

  const gated = await anonymousContext(baseURL!, { Cookie: cookie });
  try {
    const page = await gated.get(`/${INSURANCE}`, { maxRedirects: 0 });
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('name="wiki-reader-access" content="wiki"');
    expectPrivateHtml(page, "gate cookie page");
  } finally {
    await gated.dispose();
  }
});

test("login API: wrong passwords and legacy magic links are refused, the right password sets a signed cookie", async ({ baseURL }) => {
  const context = await anonymousContext(baseURL!);
  try {
    const legacy = await context.get(`/api/login?token=${GATE_PASSWORD}&redirect=%2F${encodeURIComponent(INSURANCE)}`, { maxRedirects: 0 });
    expect(legacy.status()).toBe(302);
    expect(legacy.headers()["set-cookie"]).toBeUndefined();
    expect(legacy.headers().location).toMatch(/\/sign-in\?redirect=/);
    expect(legacy.headers().location).not.toContain("token");

    const invalid = await context.post("/api/login", { data: { password: "wrong-password" } });
    expect(invalid.status()).toBe(401);
    expect(await invalid.json()).toEqual({ error: "Invalid password" });
    expect(invalid.headers()["set-cookie"]).toBeUndefined();

    const valid = await context.post("/api/login", { data: { password: GATE_PASSWORD } });
    expect(valid.ok(), await valid.text()).toBeTruthy();
    expect(await valid.json()).toEqual({ ok: true });
    expect(valid.headers()["set-cookie"]).toContain("authed=v2.");
  } finally {
    await context.dispose();
  }
});
