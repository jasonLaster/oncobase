import crypto from "node:crypto";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const RUN_NONCE = `${Date.now().toString(36)}${crypto
  .randomBytes(2)
  .toString("hex")}`;
const SITE_SLUG = `access-${RUN_NONCE}`;
const SITE_HOST = `${SITE_SLUG}.localhost`;
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

test.describe("admin access management", () => {
  test.skip(
    !CONVEX_URL,
    "Admin access tests require NEXT_PUBLIC_CONVEX_URL for the same Convex deployment as the target app.",
  );

  let convex: ConvexHttpClient;

  test.beforeAll(async () => {
    convex = new ConvexHttpClient(CONVEX_URL!);
    await convex.mutation(api.sites.create, {
      slug: SITE_SLUG,
      name: `${SITE_SLUG} (test)`,
      ownerEmail: "access@test",
      domain: SITE_HOST,
      publishTokenHash: tokenHash(),
    });
  });

  test.afterAll(async () => {
    if (!convex) return;
    try {
      await convex.mutation(api.sites.archive, { slug: SITE_SLUG });
    } catch {
      // Best-effort cleanup for local and CI runs.
    }
  });

  test("autosaves role changes from the users table", async ({
    baseURL,
    browser,
  }) => {
    const url = siteBaseURL(baseURL ?? "http://localhost:3000");
    const operatorEmail = `operator-${RUN_NONCE}@example.test`;
    const targetEmail = `target-${RUN_NONCE}@example.test`;
    const roleName = "Research reader";

    const roleId = await convex.mutation(api.access.createRole, {
      siteSlug: SITE_SLUG,
      name: roleName,
      pathPatterns: ["sources/private/*"],
    });

    const targetRequest = await playwrightRequest.newContext({
      baseURL: url,
      storageState: { cookies: [], origins: [] },
    });
    const targetSignup = await targetRequest.post("/api/auth/signup", {
      data: {
        email: targetEmail,
        password: PASSWORD,
        name: "Target User",
      },
    });
    expect(targetSignup.ok(), await targetSignup.text()).toBeTruthy();
    await targetRequest.dispose();

    const context = await browser.newContext({
      baseURL: url,
      storageState: { cookies: [], origins: [] },
    });
    const operatorSignup = await context.request.post("/api/auth/signup", {
      data: {
        email: operatorEmail,
        password: PASSWORD,
        name: "Operator User",
      },
    });
    expect(operatorSignup.ok(), await operatorSignup.text()).toBeTruthy();

    const page = await context.newPage();
    await page.goto("/admin/access");

    await expect(page.getByRole("heading", { name: "Access Control" })).toBeVisible();
    await page
      .getByRole("row", { name: new RegExp(`Target User ${targetEmail}`) })
      .getByLabel("Role for Target User")
      .selectOption(roleId);

    await expect(page.getByText("Saved").first()).toBeVisible();

    await expect
      .poll(async () => {
        const users = await convex.query(api.access.listUsersWithRoles, {
          siteSlug: SITE_SLUG,
        });
        return users.find((user) => user.email === targetEmail)?.roleIds ?? [];
      })
      .toEqual([roleId]);

    await context.close();
  });
});
