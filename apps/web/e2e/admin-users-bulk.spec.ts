import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  USER_SESSION_COOKIE,
  createPasswordSalt,
  createSessionToken,
  getSessionExpiry,
  hashPassword,
  hashSessionToken,
} from "../src/lib/user-auth";
import { cleanupSiteUsers } from "./helpers";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const RUN_NONCE = `${Date.now().toString(36)}${crypto
  .randomBytes(2)
  .toString("hex")}`;
const SITE_SLUG = `bulk-access-${RUN_NONCE}`;
const SITE_HOST = `${SITE_SLUG}.localhost`;
const OWNER_EMAIL = `owner-${RUN_NONCE}@playwright.invalid`;
const PASSWORD = "correct horse battery";

function tokenHash() {
  const token = `wpt_${crypto.randomBytes(24).toString("base64url")}`;
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function siteBaseURL(baseURL: string) {
  const url = new URL(baseURL);
  url.hostname = SITE_HOST;
  return url.toString().replace(/\/$/, "");
}

async function createTestUser(
  convex: ConvexHttpClient,
  email: string,
  name: string,
) {
  const passwordSalt = createPasswordSalt();
  return await convex.mutation(api.users.create, {
    siteSlug: SITE_SLUG,
    email,
    name,
    passwordSalt,
    passwordHash: hashPassword(PASSWORD, passwordSalt),
  });
}

test.describe("admin bulk user access actions", () => {
  test.skip(
    !CONVEX_URL,
    "Admin bulk access tests require NEXT_PUBLIC_CONVEX_URL for the target Convex deployment.",
  );

  let convex: ConvexHttpClient;

  test.beforeAll(async () => {
    convex = new ConvexHttpClient(CONVEX_URL!);
    await convex.mutation(api.sites.create, {
      slug: SITE_SLUG,
      name: `${SITE_SLUG} (test)`,
      ownerEmail: OWNER_EMAIL,
      domain: SITE_HOST,
      publishTokenHash: tokenHash(),
    });
  });

  test.afterAll(async () => {
    if (!convex) return;
    try {
      await cleanupSiteUsers(convex, SITE_SLUG);
      await convex.mutation(api.sites.archive, { slug: SITE_SLUG });
    } catch {
      // Best-effort cleanup for local and CI runs.
    }
  });

  test("assigns a role to multiple users and deletes them", async ({
    baseURL,
    browser,
  }) => {
    const url = siteBaseURL(baseURL ?? "http://localhost:3000");
    const roleName = "Bulk research reader";
    const bulkOneEmail = `bulk-one-${RUN_NONCE}@playwright.invalid`;
    const bulkTwoEmail = `bulk-two-${RUN_NONCE}@playwright.invalid`;
    const hiddenExampleTestEmail = `hidden-test-${RUN_NONCE}@example.test`;
    const hiddenExampleComEmail = `hidden-com-${RUN_NONCE}@example.com`;

    const ownerUserId = await createTestUser(convex, OWNER_EMAIL, "Owner User");
    await createTestUser(convex, bulkOneEmail, "Bulk One");
    await createTestUser(convex, bulkTwoEmail, "Bulk Two");
    await createTestUser(convex, hiddenExampleTestEmail, "Hidden Example Test");
    await createTestUser(convex, hiddenExampleComEmail, "Hidden Example Com");
    const roleId = await convex.mutation(api.access.createRole, {
      siteSlug: SITE_SLUG,
      name: roleName,
      includePathPatterns: ["sources/private/*"],
    });

    const sessionToken = createSessionToken();
    await convex.mutation(api.users.createSession, {
      siteSlug: SITE_SLUG,
      userId: ownerUserId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: getSessionExpiry(),
    });

    const context = await browser.newContext({
      baseURL: url,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: {
        Cookie: `${USER_SESSION_COOKIE}=${sessionToken}`,
      },
    });
    const page = await context.newPage();

    await page.goto("/access");
    await page.waitForURL("**/admin/users");
    await expect(
      page.getByRole("heading", { level: 1, name: "Users" }),
    ).toBeVisible();
    await expect(page.getByLabel("Select Owner User")).toBeDisabled();
    await expect(page.getByText(hiddenExampleTestEmail)).toHaveCount(0);
    await expect(page.getByText(hiddenExampleComEmail)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assign role" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();

    await page.getByLabel("Select Bulk One").check();
    await page.getByLabel("Select Bulk Two").check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByLabel("Role for selected users").selectOption(roleId);
    await page.getByRole("button", { name: "Assign role" }).click();

    await expect
      .poll(async () => {
        const users = await convex.query(api.access.listUsersWithRoles, {
          siteSlug: SITE_SLUG,
        });
        return users
          .filter((user) =>
            [bulkOneEmail, bulkTwoEmail].includes(user.email),
          )
          .map((user) => user.roleIds)
          .sort();
      })
      .toEqual([[roleId], [roleId]]);

    await page.getByLabel("Select Bulk One").check();
    await page.getByLabel("Select Bulk Two").check();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete selected users" }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Delete selected users" })
      .getByRole("button", { name: "Delete" })
      .click();

    await expect
      .poll(async () => {
        const users = await convex.query(api.access.listUsersWithRoles, {
          siteSlug: SITE_SLUG,
        });
        return users.filter((user) =>
          [bulkOneEmail, bulkTwoEmail].includes(user.email),
        ).length;
      })
      .toBe(0);

    await context.close();
  });
});
