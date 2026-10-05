import crypto from "node:crypto";
import { createRequire } from "node:module";
import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse } from "@playwright/test";

// Request-only helpers for the contract suite. They talk to the app server and,
// for fixtures, to the local Convex stack through the same service client the
// server uses (`bun run local:stack exec -- ...` provides its credentials).
// Fixtures live on the seeded site under unique, per-run slugs and are removed
// in teardown, so a stack can be reused between runs.
const require = createRequire(import.meta.url);
const { api } = require("../../convex/_generated/api.js") as typeof import("../../convex/_generated/api");
const { createBackendClient } = require("../../server/backend-client.ts") as typeof import("../../server/backend-client");

export const GATE_PASSWORD = (process.env.PLAYWRIGHT_BASE_URL && process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD) || "diana";
export const SITE_SLUG = "diana";
/** Identifiers that must never leave the API boundary on the default site. */
export const RAW_IDENTIFIERS = /Diana Laster|88855655|jason\.laster\.11@gmail\.com/i;
export const USER_PASSWORD = "correct horse battery";

export const requireLocalStack = () =>
  test.skip(
    !process.env.NEXT_PUBLIC_CONVEX_URL,
    "Requires the local stack: bun run local:stack exec -- bunx playwright test e2e/contract",
  );

/** A deployed preview fronts synthetic Host headers with its own routing. */
export const runsAgainstPreview = Boolean(process.env.PLAYWRIGHT_BASE_URL);
/** Single-site servers pin every Host to one site, so Host resolution is unobservable. */
export const pinnedSite = Boolean(process.env.WIKI_SITE_SLUG?.trim());

/** A fresh cookie jar: no gate, no session. */
export function anonymousContext(baseURL: string, headers: Record<string, string> = {}) {
  return playwrightRequest.newContext({ baseURL, extraHTTPHeaders: headers, storageState: { cookies: [], origins: [] } });
}

/** Passed the site password gate only. */
export async function gatedContext(baseURL: string, headers: Record<string, string> = {}) {
  const context = await anonymousContext(baseURL, headers);
  const login = await context.post("/api/login", { data: { password: GATE_PASSWORD } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return context;
}

/** The signed gate cookie, for sending as a raw header. */
export async function gateCookie(baseURL: string) {
  const context = await anonymousContext(baseURL);
  try {
    const login = await context.post("/api/login", { data: { password: GATE_PASSWORD } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const cookie = login.headers()["set-cookie"]?.split(";")[0];
    expect(cookie, "gate cookie").toMatch(/^authed=.+/);
    return cookie!;
  } finally {
    await context.dispose();
  }
}

export async function signedInContext(baseURL: string, user: { email: string; password: string }, mode: "signin" | "signup" = "signin") {
  const context = await gatedContext(baseURL);
  const response = await context.post(`/api/auth/${mode}`, {
    data: mode === "signup" ? { ...user, name: user.email.split("@")[0] } : user,
  });
  expect(response.ok(), `${mode} ${user.email}: ${await response.text()}`).toBeTruthy();
  return context;
}

export type PagesBody = {
  pages: Array<{ slug: string; title: string; content: string; sensitive?: boolean }>;
  unavailable?: Array<{ slug: string; reason: string }>;
};

export async function fetchPages(context: APIRequestContext, slug: string, scope: "public" | "session" = "session") {
  const response = await context.get(`/api/wiki/pages?scope=${scope}&slugs=${encodeURIComponent(slug)}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as PagesBody;
}

export const assertPrivate = (response: APIResponse, label: string, vary = true) => {
  expect(response.headers()["cache-control"], `${label} cache-control`).toBe("private, no-store");
  if (vary) expect(response.headers().vary, `${label} vary`).toContain("Cookie");
};

type DocumentFixture = {
  slug: string;
  title: string;
  content: string;
  tags?: string[];
  sensitive?: boolean;
  sensitiveInclude?: string[];
};

/** Per-run fixtures on the seeded site, removed by `dispose`. */
export function createFixtureSite() {
  const convex = createBackendClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const nonce = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
  const documents: string[] = [];
  const roles: string[] = [];
  const emails = new Set<string>();

  return {
    nonce,
    email: (label: string, domain = "example.test") => {
      const email = `contract-${nonce}-${label}@${domain}`;
      emails.add(email);
      return email;
    },
    async document(doc: DocumentFixture) {
      await convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: doc.slug,
        title: doc.title,
        content: doc.content,
        tags: doc.tags ?? [],
        sensitive: doc.sensitive ?? false,
        ...(doc.sensitiveInclude ? { sensitiveInclude: doc.sensitiveInclude } : {}),
        contentHash: `${nonce}-${crypto.createHash("sha1").update(doc.slug + doc.content).digest("hex").slice(0, 12)}`,
      });
      documents.push(doc.slug);
    },
    async role(role: {
      name: string;
      includePathPatterns?: string[];
      excludePathPatterns?: string[];
      includeTags?: string[];
      excludeTags?: string[];
      emailPatterns?: string[];
    }) {
      const roleId = await convex.mutation(api.access.createRole, { siteSlug: SITE_SLUG, ...role, name: `contract-${nonce}-${role.name}` });
      roles.push(roleId);
      return roleId;
    },
    async assign(email: string, roleId: string) {
      const account = await convex.query(api.users.getByEmailForAuth, { siteSlug: SITE_SLUG, email });
      expect(account, `account ${email}`).toBeTruthy();
      await convex.mutation(api.access.assignRoleToUser, { siteSlug: SITE_SLUG, userId: account!._id, roleId: roleId as never });
    },
    async dispose() {
      const settled = async (work: Array<Promise<unknown>>) => { await Promise.allSettled(work); };
      // Users first so role deletion never races their assignments.
      const accounts = await Promise.all(
        [...emails].map((email) => convex.query(api.users.getByEmailForAuth, { siteSlug: SITE_SLUG, email }).catch(() => null)),
      );
      const userIds = accounts.flatMap((account) => (account ? [account._id] : []));
      if (userIds.length) await convex.mutation(api.access.deleteUsers, { siteSlug: SITE_SLUG, userIds }).catch(() => undefined);
      await settled(roles.map((roleId) => convex.mutation(api.access.deleteRole, { siteSlug: SITE_SLUG, roleId: roleId as never })));
      await settled(documents.map((slug) => convex.mutation(api.documents.deleteBySlug, { siteSlug: SITE_SLUG, slug })));
    },
  };
}

/** One document that carries every default-site identifier, for redaction checks. */
export const piiDocument = (nonce: string): DocumentFixture => ({
  slug: `sources/contract-${nonce}/pii-note`,
  title: `Contract PII note ${nonce}`,
  tags: ["contract-pii"],
  content: `# Contract PII note\n\nDiana Laster (MRN 88855655) can be reached at jason.laster.11@gmail.com. Marker piimark${nonce}.\n`,
});
