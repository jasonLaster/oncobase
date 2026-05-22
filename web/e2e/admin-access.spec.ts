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
const OWNER_EMAIL = `operator-${RUN_NONCE}@example.test`;
const PASSWORD = "correct horse battery";
const PREVIEW_INCLUDED_SLUG = `sources/private/preview-included-${RUN_NONCE}`;
const PREVIEW_EXCLUDED_SLUG = `sources/private/preview-excluded-${RUN_NONCE}`;
const PREVIEW_PUBLIC_SLUG = `sources/public/preview-public-${RUN_NONCE}`;
const PREVIEW_INCLUDED_TITLE = "Preview Included Source";
const PREVIEW_EXCLUDED_TITLE = "Preview Excluded Source";

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
      ownerEmail: OWNER_EMAIL,
      domain: SITE_HOST,
      publishTokenHash: tokenHash(),
    });
    await Promise.all([
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: PREVIEW_INCLUDED_SLUG,
        title: PREVIEW_INCLUDED_TITLE,
        content: "Included preview fixture",
        tags: ["research-private"],
        contentHash: `test:${PREVIEW_INCLUDED_SLUG}`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: PREVIEW_EXCLUDED_SLUG,
        title: PREVIEW_EXCLUDED_TITLE,
        content: "Excluded preview fixture",
        tags: ["research-private", "public-summary"],
        contentHash: `test:${PREVIEW_EXCLUDED_SLUG}`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: PREVIEW_PUBLIC_SLUG,
        title: "Preview Public Source",
        content: "Public preview fixture",
        tags: ["public-summary"],
        contentHash: `test:${PREVIEW_PUBLIC_SLUG}`,
        sensitive: false,
      }),
    ]);
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
    const operatorEmail = OWNER_EMAIL;
    const targetEmail = `target-${RUN_NONCE}@example.test`;
    const roleName = "Research reader";

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
    await page.goto("/");
    const actions = page.getByTestId("sidebar-workspace-trigger");
    const themeItem = page.getByRole("menuitem", {
      name: /Theme: (System|Dark|Light)/,
    });
    await expect(actions).toBeVisible();
    await actions.click();
    if (!(await themeItem.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await actions.click();
    }
    await expect(themeItem).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Admin" })).toBeVisible();

    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Users/ })).toHaveAttribute(
      "href",
      "/admin/access#users",
    );
    await expect(page.getByRole("link", { name: /Roles/ })).toHaveAttribute(
      "href",
      "/admin/access#roles",
    );

    await page.goto("/admin/access");

    await expect(page.getByRole("heading", { name: "Access Control" })).toBeVisible();
    await expect(page.getByRole("complementary")).toHaveCount(0);

    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByRole("dialog", { name: "Create role" })).toBeVisible();
    await page.getByLabel("Role name").fill(roleName);
    await page.getByLabel("Include paths").fill("sources/private/*");
    await page.getByLabel("Exclude paths").fill(PREVIEW_EXCLUDED_SLUG);
    const createDialog = page.getByRole("dialog", { name: "Create role" });
    await createDialog.getByRole("tab", { name: "Preview" }).click();
    await expect(createDialog.getByText(PREVIEW_INCLUDED_TITLE)).toBeVisible();
    await expect(createDialog.getByText(PREVIEW_EXCLUDED_TITLE)).toBeVisible();
    await createDialog.getByRole("button", { name: /Excluded \d+/ }).click();
    await expect(createDialog.getByText(PREVIEW_EXCLUDED_TITLE)).toBeVisible();
    await expect(createDialog.getByText(PREVIEW_INCLUDED_TITLE)).toBeHidden();
    await createDialog.getByLabel("Filter pages").fill("included");
    await expect(createDialog.getByText("No pages match")).toBeVisible();
    await createDialog.getByLabel("Filter pages").fill("");
    await createDialog.getByRole("button", { name: /Included \d+/ }).click();
    await expect(createDialog.getByText(PREVIEW_INCLUDED_TITLE)).toBeVisible();
    await createDialog.getByRole("tab", { name: "Rules" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog", { name: "Create role" })).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(roleName) })).toBeVisible();

    await page.setViewportSize({ width: 500, height: 800 });
    const roleTableWidths = await page
      .locator("table")
      .first()
      .evaluate((element) => ({
        clientWidth: element.parentElement?.clientWidth ?? 0,
        scrollWidth: element.parentElement?.scrollWidth ?? 0,
      }));
    expect(roleTableWidths.scrollWidth).toBeGreaterThan(
      roleTableWidths.clientWidth,
    );
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.setViewportSize({ width: 500, height: 360 });
    const pageScroll = await page.locator("main").evaluate((element) => {
      element.scrollTop = 100;
      const style = window.getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });
    expect(pageScroll.overflowY).toBe("auto");
    expect(pageScroll.scrollHeight).toBeGreaterThan(pageScroll.clientHeight);
    expect(pageScroll.scrollTop).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    let roleId = "";
    await expect
      .poll(async () => {
        const roles = await convex.query(api.access.listRoles, {
          siteSlug: SITE_SLUG,
        });
        roleId = String(roles.find((role) => role.name === roleName)?._id ?? "");
        return roleId;
      })
      .not.toBe("");

    await page.getByRole("button", { name: `Actions for ${roleName}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByRole("dialog", { name: "Edit role" })).toBeVisible();
    await page.setViewportSize({ width: 500, height: 360 });
    const editDialog = page.getByRole("dialog", { name: "Edit role" });
    await editDialog.getByRole("tab", { name: "Preview" }).click();
    const dialogBounds = await editDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        top: rect.top,
        viewportHeight: window.innerHeight,
      };
    });
    expect(dialogBounds.top).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.bottom).toBeLessThanOrEqual(dialogBounds.viewportHeight);
    await expect(editDialog.getByRole("button", { name: "Save" })).toBeVisible();
    await editDialog.getByRole("tab", { name: "Rules" }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByLabel("Exclude paths").fill("sources/private/public-summary");
    await page.getByLabel("Include tags").fill("research-private");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog", { name: "Edit role" })).toBeHidden();

    await expect
      .poll(async () => {
        const roles = await convex.query(api.access.listRoles, {
          siteSlug: SITE_SLUG,
        });
        const role = roles.find((item) => item.name === roleName);
        return {
          excludePathPatterns: role?.excludePathPatterns ?? [],
          includeTags: role?.includeTags ?? [],
        };
      })
      .toEqual({
        excludePathPatterns: ["sources/private/public-summary"],
        includeTags: ["research-private"],
      });

    await page
      .getByRole("row", { name: new RegExp(`Target User ${targetEmail}`) })
      .getByLabel("Role for Target User")
      .selectOption(roleId);

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
