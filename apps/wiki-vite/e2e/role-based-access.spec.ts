import crypto from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { createRequire } from "node:module";

const { api } = createRequire(import.meta.url)(
  "../../web/convex/_generated/api.js",
) as typeof import("../../web/convex/_generated/api");
import { cleanupSiteUsers } from "../../web/e2e/helpers";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const RUN_NONCE = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const SITE_SLUG = `vite-rbac-${RUN_NONCE}`;
const SITE_HOST = `${SITE_SLUG}.localhost`;
const PUBLIC_SLUG = "sources/rbac-public";
const PROTECTED_SLUG = "sources/rbac-private";
const TAG_PROTECTED_SLUG = "sources/rbac-tag-private";
const TAG_EXCLUDED_SLUG = "sources/rbac-tag-excluded";
const PATH_EXCLUDED_SLUG = "sources/rbac-private/excluded";
const SEROVA_SENSITIVE_SLUG = "sources/rbac-serova-sensitive";
const PASSWORD = "correct horse battery";

function tokenHash() {
  const token = `wpt_${crypto.randomBytes(24).toString("base64url")}`;
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

async function newSiteUserContext(baseURL: string, email: string) {
  const context = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Host: SITE_HOST },
    storageState: { cookies: [], origins: [] },
  });
  const response = await context.post("/api/auth/signup", {
    data: { email, password: PASSWORD, name: email.split("@")[0] },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return context;
}

async function fetchPages(context: APIRequestContext, slug: string, scope: "public" | "session" = "session") {
  const response = await context.get(`/api/wiki/pages?scope=${scope}&slugs=${encodeURIComponent(slug)}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as {
    pages: Array<{ slug: string; title: string; content: string; sensitive?: boolean }>;
    unavailable?: Array<{ slug: string; reason: string }>;
  };
}

test.describe("Vite role-based reader access", () => {
  test.skip(!CONVEX_URL, "Requires NEXT_PUBLIC_CONVEX_URL for the target Convex deployment.");

  let convex: ConvexHttpClient;
  let anonymous: APIRequestContext;
  let unassignedUser: APIRequestContext;
  let assignedUser: APIRequestContext;
  let serovaUser: APIRequestContext;

  test.beforeAll(async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:61001";
    convex = new ConvexHttpClient(CONVEX_URL!);

    await convex.mutation(api.sites.create, {
      slug: SITE_SLUG,
      name: `${SITE_SLUG} (test)`,
      ownerEmail: "rbac@test",
      domain: SITE_HOST,
      publishTokenHash: tokenHash(),
    });

    await Promise.all([
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: PUBLIC_SLUG,
        title: "RBAC Public Source",
        content: "This public source must remain readable without a role.",
        tags: ["rbac-test"],
        contentHash: `${RUN_NONCE}-public`,
        sensitive: false,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: PROTECTED_SLUG,
        title: "RBAC Protected Source",
        content: "Protected source marker only assigned users should see.",
        tags: ["rbac-test"],
        contentHash: `${RUN_NONCE}-protected`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: TAG_PROTECTED_SLUG,
        title: "RBAC Tag Protected Source",
        content: "Tag protected marker only matching tag roles should see.",
        tags: ["rbac-tag"],
        contentHash: `${RUN_NONCE}-tag-protected`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: TAG_EXCLUDED_SLUG,
        title: "RBAC Tag Excluded Source",
        content: "Excluded tag marker assigned users should not see.",
        tags: ["rbac-tag", "rbac-excluded"],
        contentHash: `${RUN_NONCE}-tag-excluded`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: PATH_EXCLUDED_SLUG,
        title: "RBAC Path Excluded Source",
        content: "Path excluded marker assigned users should not see.",
        tags: ["rbac-test"],
        contentHash: `${RUN_NONCE}-path-excluded`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: SEROVA_SENSITIVE_SLUG,
        title: "RBAC Serova Sensitive Source",
        content: "Serova sensitive marker only matching email domains should see.",
        tags: [],
        sensitiveInclude: ["serova"],
        contentHash: `${RUN_NONCE}-serova-sensitive`,
        sensitive: true,
      }),
    ]);

    anonymous = await playwrightRequest.newContext({
      baseURL: url,
      extraHTTPHeaders: { Host: SITE_HOST },
      storageState: { cookies: [], origins: [] },
    });
    unassignedUser = await newSiteUserContext(url, `unassigned-${RUN_NONCE}@example.test`);
    assignedUser = await newSiteUserContext(url, `assigned-${RUN_NONCE}@example.test`);
    serovaUser = await newSiteUserContext(url, `serova-${RUN_NONCE}@serova.bio`);

    const assignedAccount = await convex.query(api.users.getByEmailForAuth, {
      siteSlug: SITE_SLUG,
      email: `assigned-${RUN_NONCE}@example.test`,
    });
    expect(assignedAccount).toBeTruthy();

    const roleId = await convex.mutation(api.access.createRole, {
      siteSlug: SITE_SLUG,
      name: "Protected source reader",
      includePathPatterns: ["sources/rbac-private*"],
      excludePathPatterns: [PATH_EXCLUDED_SLUG],
    });
    const tagRoleId = await convex.mutation(api.access.createRole, {
      siteSlug: SITE_SLUG,
      name: "Tag source reader",
      includePathPatterns: ["sources/*"],
      includeTags: ["rbac-tag"],
      excludeTags: ["rbac-excluded"],
    });
    await Promise.all([
      convex.mutation(api.access.assignRoleToUser, {
        siteSlug: SITE_SLUG,
        userId: assignedAccount!._id,
        roleId,
      }),
      convex.mutation(api.access.assignRoleToUser, {
        siteSlug: SITE_SLUG,
        userId: assignedAccount!._id,
        roleId: tagRoleId,
      }),
      convex.mutation(api.access.createRole, {
        siteSlug: SITE_SLUG,
        name: "Serova sensitive reader",
        includeTags: ["serova-sensitive"],
        emailPatterns: ["serova.bio"],
      }),
    ]);
  });

  test.afterAll(async () => {
    await Promise.allSettled([
      anonymous?.dispose(),
      unassignedUser?.dispose(),
      assignedUser?.dispose(),
      serovaUser?.dispose(),
    ]);
    if (!convex) return;
    try {
      await Promise.all(
        [
          PUBLIC_SLUG,
          PROTECTED_SLUG,
          TAG_PROTECTED_SLUG,
          TAG_EXCLUDED_SLUG,
          PATH_EXCLUDED_SLUG,
          SEROVA_SENSITIVE_SLUG,
        ].map((slug) => convex.mutation(api.documents.deleteBySlug, { siteSlug: SITE_SLUG, slug })),
      );
      await cleanupSiteUsers(convex, SITE_SLUG);
      await convex.mutation(api.sites.archive, { slug: SITE_SLUG });
    } catch {
      // Best-effort cleanup for local and CI runs.
    }
  });

  test("keeps public pages readable without a role", async () => {
    const body = await fetchPages(anonymous, PUBLIC_SLUG, "public");
    expect(body.pages[0]?.title).toBe("RBAC Public Source");
  });

  test("returns sensitive-unavailable for signed-in users without a matching role", async () => {
    const body = await fetchPages(unassignedUser, PROTECTED_SLUG);
    expect(body.pages).toHaveLength(0);
    expect(body.unavailable).toMatchObject([
      { slug: PROTECTED_SLUG, reason: "sensitive-unavailable" },
    ]);
  });

  test("renders protected pages for matching path, tag, and email-domain roles", async () => {
    expect((await fetchPages(assignedUser, PROTECTED_SLUG)).pages[0]?.content).toContain(
      "Protected source marker",
    );
    expect((await fetchPages(assignedUser, TAG_PROTECTED_SLUG)).pages[0]?.title).toBe(
      "RBAC Tag Protected Source",
    );
    expect((await fetchPages(serovaUser, SEROVA_SENSITIVE_SLUG)).pages[0]?.title).toBe(
      "RBAC Serova Sensitive Source",
    );
  });

  test("applies path and tag exclusions", async () => {
    expect((await fetchPages(assignedUser, PATH_EXCLUDED_SLUG)).unavailable?.[0]?.slug).toBe(
      PATH_EXCLUDED_SLUG,
    );
    expect((await fetchPages(assignedUser, TAG_EXCLUDED_SLUG)).unavailable?.[0]?.slug).toBe(
      TAG_EXCLUDED_SLUG,
    );
  });
});
