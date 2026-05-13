import crypto from "node:crypto";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const RUN_NONCE = `${Date.now().toString(36)}${crypto
  .randomBytes(2)
  .toString("hex")}`;
const SITE_SLUG = `rbac-${RUN_NONCE}`;
const SITE_HOST = `${SITE_SLUG}.localhost`;
const PUBLIC_SLUG = "sources/rbac-public";
const PROTECTED_SLUG = "sources/rbac-private";
const TAG_PROTECTED_SLUG = "sources/rbac-tag-private";
const TAG_EXCLUDED_SLUG = "sources/rbac-tag-excluded";
const PATH_EXCLUDED_SLUG = "sources/rbac-private/excluded";
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
    data: {
      email,
      password: PASSWORD,
      name: email.split("@")[0],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return context;
}

async function expectSourceStatus(
  context: APIRequestContext,
  slug: string,
  status: number,
) {
  const response = await context.get(`/${slug}`, { maxRedirects: 0 });
  expect(response.status(), await response.text()).toBe(status);
  return response;
}

async function expectSourceNotFound(context: APIRequestContext, slug: string) {
  const response = await context.get(`/${slug}`, { maxRedirects: 0 });
  const html = await response.text();

  expect([200, 404]).toContain(response.status());
  expect(html).toContain("next-error");
  expect(html).toContain("not-found");
  expect(html).not.toContain("RBAC Protected Source");
  expect(html).not.toContain("Protected source marker only assigned users should see.");
}

test.describe("role-based access permissions", () => {
  test.skip(
    !CONVEX_URL,
    "Role-based access tests require NEXT_PUBLIC_CONVEX_URL for the same Convex deployment as the target app.",
  );

  let convex: ConvexHttpClient;
  let anonymous: APIRequestContext;
  let unassignedUser: APIRequestContext;
  let assignedUser: APIRequestContext;

  test.beforeAll(async ({ baseURL }) => {
    const url = baseURL ?? "http://localhost:3000";
    convex = new ConvexHttpClient(CONVEX_URL!);

    await convex.mutation(api.sites.create, {
      slug: SITE_SLUG,
      name: `${SITE_SLUG} (test)`,
      ownerEmail: "rbac@test",
      domain: SITE_HOST,
      publishTokenHash: tokenHash(),
    });

    await convex.mutation(api.documents.upsert, {
      siteSlug: SITE_SLUG,
      slug: PUBLIC_SLUG,
      title: "RBAC Public Source",
      content: "This public source must remain readable without a role.",
      tags: ["rbac-test"],
      contentHash: `${RUN_NONCE}-public`,
      sensitive: false,
    });
    await convex.mutation(api.documents.upsert, {
      siteSlug: SITE_SLUG,
      slug: PROTECTED_SLUG,
      title: "RBAC Protected Source",
      content: "Protected source marker only assigned users should see.",
      tags: ["rbac-test"],
      contentHash: `${RUN_NONCE}-protected`,
      sensitive: true,
    });
    await convex.mutation(api.documents.upsert, {
      siteSlug: SITE_SLUG,
      slug: TAG_PROTECTED_SLUG,
      title: "RBAC Tag Protected Source",
      content: "Tag protected marker only matching tag roles should see.",
      tags: ["rbac-tag"],
      contentHash: `${RUN_NONCE}-tag-protected`,
      sensitive: true,
    });
    await convex.mutation(api.documents.upsert, {
      siteSlug: SITE_SLUG,
      slug: TAG_EXCLUDED_SLUG,
      title: "RBAC Tag Excluded Source",
      content: "Excluded tag marker assigned users should not see.",
      tags: ["rbac-tag", "rbac-excluded"],
      contentHash: `${RUN_NONCE}-tag-excluded`,
      sensitive: true,
    });
    await convex.mutation(api.documents.upsert, {
      siteSlug: SITE_SLUG,
      slug: PATH_EXCLUDED_SLUG,
      title: "RBAC Path Excluded Source",
      content: "Path excluded marker assigned users should not see.",
      tags: ["rbac-test"],
      contentHash: `${RUN_NONCE}-path-excluded`,
      sensitive: true,
    });

    anonymous = await playwrightRequest.newContext({
      baseURL: url,
      extraHTTPHeaders: { Host: SITE_HOST },
      storageState: { cookies: [], origins: [] },
    });
    unassignedUser = await newSiteUserContext(
      url,
      `unassigned-${RUN_NONCE}@example.test`,
    );
    assignedUser = await newSiteUserContext(
      url,
      `assigned-${RUN_NONCE}@example.test`,
    );

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
    await convex.mutation(api.access.assignRoleToUser, {
      siteSlug: SITE_SLUG,
      userId: assignedAccount!._id,
      roleId,
    });

    const tagRoleId = await convex.mutation(api.access.createRole, {
      siteSlug: SITE_SLUG,
      name: "Tag source reader",
      includePathPatterns: ["sources/*"],
      includeTags: ["rbac-tag"],
      excludeTags: ["rbac-excluded"],
    });
    await convex.mutation(api.access.assignRoleToUser, {
      siteSlug: SITE_SLUG,
      userId: assignedAccount!._id,
      roleId: tagRoleId,
    });
  });

  test.afterAll(async () => {
    await Promise.allSettled([
      anonymous?.dispose(),
      unassignedUser?.dispose(),
      assignedUser?.dispose(),
    ]);
    if (!convex) return;
    try {
      await convex.mutation(api.documents.deleteBySlug, {
        siteSlug: SITE_SLUG,
        slug: PUBLIC_SLUG,
      });
      await convex.mutation(api.documents.deleteBySlug, {
        siteSlug: SITE_SLUG,
        slug: PROTECTED_SLUG,
      });
      await convex.mutation(api.documents.deleteBySlug, {
        siteSlug: SITE_SLUG,
        slug: TAG_PROTECTED_SLUG,
      });
      await convex.mutation(api.documents.deleteBySlug, {
        siteSlug: SITE_SLUG,
        slug: TAG_EXCLUDED_SLUG,
      });
      await convex.mutation(api.documents.deleteBySlug, {
        siteSlug: SITE_SLUG,
        slug: PATH_EXCLUDED_SLUG,
      });
      await convex.mutation(api.sites.archive, { slug: SITE_SLUG });
    } catch {
      // Best-effort cleanup for local and CI runs.
    }
  });

  test("keeps public source pages readable without a role", async () => {
    const response = await expectSourceStatus(anonymous, PUBLIC_SLUG, 200);
    await expect(await response.text()).toContain("RBAC Public Source");
  });

  test("hides protected source pages from anonymous users", async () => {
    await expectSourceNotFound(anonymous, PROTECTED_SLUG);
  });

  test("hides protected source pages from signed-in users without a matching role", async () => {
    await expectSourceNotFound(unassignedUser, PROTECTED_SLUG);
  });

  test("renders protected source pages for signed-in users with a matching role", async () => {
    const response = await expectSourceStatus(assignedUser, PROTECTED_SLUG, 200);
    const html = await response.text();
    expect(html).toContain("RBAC Protected Source");
    expect(html).toContain("Protected source marker only assigned users should see.");
  });

  test("applies include and exclude path rules", async () => {
    await expectSourceNotFound(assignedUser, PATH_EXCLUDED_SLUG);
  });

  test("applies include and exclude tag rules", async () => {
    await expectSourceNotFound(unassignedUser, TAG_PROTECTED_SLUG);

    const allowed = await expectSourceStatus(assignedUser, TAG_PROTECTED_SLUG, 200);
    expect(await allowed.text()).toContain("RBAC Tag Protected Source");

    await expectSourceNotFound(assignedUser, TAG_EXCLUDED_SLUG);
  });
});
