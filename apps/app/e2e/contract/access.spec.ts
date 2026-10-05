import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  createFixtureSite,
  fetchPages,
  gatedContext,
  requireLocalStack,
  signedInContext,
  USER_PASSWORD,
} from "./helpers";

// Role access on the real Convex stack: path and tag roles grant; exclusions, a
// missing role and email-pattern roles on a new signup deny (signup does not
// verify the mailbox, so patterns only apply to accounts that predate the cutoff). Replaces role-based-access and
// tag-page-access, which created a whole site and so only ran against a cloud
// deployment. Fixtures here live under per-run slugs on the seeded site.
requireLocalStack();

const fixtures = createFixtureSite();
const { nonce } = fixtures;
const TAG = `contract-tag-${nonce}`;
const EXCLUDED_TAG = `contract-excluded-${nonce}`;

const slugs = {
  public: `sources/rbac-${nonce}/public`,
  protected: `sources/rbac-${nonce}-private`,
  pathExcluded: `sources/rbac-${nonce}-private/excluded`,
  tagProtected: `sources/rbac-${nonce}-tag-private`,
  tagExcluded: `sources/rbac-${nonce}-tag-excluded`,
  domain: `sources/rbac-${nonce}-domain`,
  tagPublic: `sources/research/${TAG}-public`,
  tagAllowed: `sources/meeting-notes/${TAG}-allowed`,
  tagDenied: `sources/private/${TAG}-denied`,
};

let anonymous: APIRequestContext;
const sessions: Record<"unassigned" | "assigned" | "owner" | "domain", APIRequestContext> = {} as never;

test.beforeAll(async ({ baseURL }) => {
  const doc = (slug: string, title: string, extra: { tags?: string[]; sensitive?: boolean; sensitiveInclude?: string[] } = {}) =>
    fixtures.document({ slug, title, content: `${title} marker ${nonce}.`, ...extra });
  await Promise.all([
    doc(slugs.public, "RBAC Public Source", { tags: [TAG] }),
    doc(slugs.protected, "RBAC Protected Source", { sensitive: true }),
    doc(slugs.pathExcluded, "RBAC Path Excluded Source", { sensitive: true }),
    doc(slugs.tagProtected, "RBAC Tag Protected Source", { tags: [`rbac-tag-${nonce}`], sensitive: true }),
    doc(slugs.tagExcluded, "RBAC Tag Excluded Source", { tags: [`rbac-tag-${nonce}`, EXCLUDED_TAG], sensitive: true }),
    doc(slugs.domain, "RBAC Domain Source", { sensitive: true, sensitiveInclude: ["serova"] }),
    doc(slugs.tagPublic, "Tag Public Fixture", { tags: [TAG] }),
    doc(slugs.tagAllowed, "Tag Meeting Note Fixture", { tags: [TAG], sensitive: true }),
    doc(slugs.tagDenied, "Tag Denied Fixture", { tags: [TAG], sensitive: true }),
  ]);

  const emails = {
    unassigned: fixtures.email("unassigned"),
    assigned: fixtures.email("assigned"),
    owner: fixtures.email("owner"),
    domain: fixtures.email("domain", "serova.bio"),
  };
  anonymous = await gatedContext(baseURL!);
  for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
    sessions[key] = await signedInContext(baseURL!, { email: emails[key], password: USER_PASSWORD }, "signup");
  }

  const [pathRole, tagRole, meetingRole, privateRole] = await Promise.all([
    fixtures.role({ name: "path", includePathPatterns: [`sources/rbac-${nonce}-private*`], excludePathPatterns: [slugs.pathExcluded] }),
    fixtures.role({ name: "tag", includePathPatterns: ["sources/*"], includeTags: [`rbac-tag-${nonce}`], excludeTags: [EXCLUDED_TAG] }),
    fixtures.role({ name: "meeting", includePathPatterns: ["sources/meeting-notes/*"], includeTags: [TAG] }),
    fixtures.role({ name: "private", includePathPatterns: [slugs.tagDenied] }),
  ]);
  // Email-pattern role: must NOT apply to the fresh signup below (audit V-2).
  await fixtures.role({ name: "domain", includeTags: ["serova-sensitive"], emailPatterns: ["serova.bio"] });
  await Promise.all([
    fixtures.assign(emails.assigned, pathRole),
    fixtures.assign(emails.assigned, tagRole),
    fixtures.assign(emails.assigned, meetingRole),
    fixtures.assign(emails.owner, meetingRole),
    fixtures.assign(emails.owner, privateRole),
  ]);
});

test.afterAll(async () => {
  await Promise.allSettled([anonymous?.dispose(), ...Object.values(sessions).map((context) => context?.dispose())]);
  await fixtures.dispose();
});

type Outcome = "reads" | "unavailable";
const outcome = async (context: APIRequestContext, slug: string, scope: "public" | "session" = "session"): Promise<Outcome> => {
  const body = await fetchPages(context, slug, scope);
  if (body.pages.length) return "reads";
  expect(body.unavailable?.map((entry) => entry.reason), slug).toEqual(["sensitive-unavailable"]);
  return "unavailable";
};

test("roles grant by path and tag; exclusions, a missing role and an email-pattern role on a new signup are denied", async () => {
  // user -> slug -> outcome. Every denial must be the explicit sensitive-unavailable
  // answer (never a 404 or an empty page that a blank response would also satisfy).
  const matrix: Array<[keyof typeof sessions, string, Outcome]> = [
    ["unassigned", slugs.protected, "unavailable"],
    ["unassigned", slugs.tagProtected, "unavailable"],
    ["unassigned", slugs.domain, "unavailable"],
    ["assigned", slugs.protected, "reads"],
    ["assigned", slugs.tagProtected, "reads"],
    ["assigned", slugs.pathExcluded, "unavailable"],
    ["assigned", slugs.tagExcluded, "unavailable"],
    ["assigned", slugs.domain, "unavailable"],
    ["domain", slugs.domain, "unavailable"],
    ["domain", slugs.protected, "unavailable"],
  ];
  const actual = await Promise.all(matrix.map(async ([user, slug]) => outcome(sessions[user], slug)));
  expect(actual).toEqual(matrix.map(([, , expected]) => expected));

  // Public pages need no role, and a gate-only visitor is not a session.
  expect((await fetchPages(anonymous, slugs.public, "public")).pages[0]?.title).toBe("RBAC Public Source");
  const gateOnly = await anonymous.get(`/api/wiki/pages?scope=session&slugs=${encodeURIComponent(slugs.protected)}`);
  expect(gateOnly.status()).toBe(401);
});

test("the manifest lists exactly the pages each account can read for a tag", async () => {
  const tagged = async (context: APIRequestContext, scope: "public" | "session") => {
    const response = await context.get(`/api/wiki/manifest?scope=${scope}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const { pages } = (await response.json()) as { pages: Array<{ slug: string; tags?: string[] }> };
    return pages.filter((page) => page.tags?.includes(TAG)).map((page) => page.slug).sort();
  };
  const publicOnly = [slugs.public, slugs.tagPublic].sort();
  expect(await tagged(anonymous, "public")).toEqual(publicOnly);
  expect(await tagged(sessions.unassigned, "session")).toEqual(publicOnly);
  expect(await tagged(sessions.assigned, "session")).toEqual([...publicOnly, slugs.tagAllowed].sort());
  expect(await tagged(sessions.owner, "session")).toEqual([...publicOnly, slugs.tagAllowed, slugs.tagDenied].sort());
});
