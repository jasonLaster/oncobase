import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createBackendClient } from "../../server/backend-client";
import { createPasswordSalt, hashPassword } from "../../server/user-auth";
import { api } from "../../convex/_generated/api";
import { passGate, READER, requireLocalStack } from "./helpers";

// Real backend, no route mocks. The local stack's site owner (owner@local.test)
// is an admin. Fixtures (users and a role) are created through the same service
// client the stack seeds with, and removed afterwards.
requireLocalStack();

const SITE = "diana";
const ADMIN = {
  email: process.env.LOCAL_STACK_ADMIN_EMAIL ?? "owner@local.test",
  password: process.env.LOCAL_STACK_ADMIN_PASSWORD ?? "local-admin-password",
};
const NONCE = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const ROLE_NAME = `E2E role ${NONCE}`;
const targets = ["One", "Two", "Three"].map((label) => ({
  name: `E2E ${NONCE} ${label}`,
  email: `e2e-${NONCE}-${label.toLowerCase()}@playwright.invalid`,
}));

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/?reader-action=signin");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await dialog.getByLabel("Email", { exact: true }).fill(user.email);
  await dialog.getByLabel("Password", { exact: true }).fill(user.password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("admin (real backend)", () => {
  // Fixtures are shared and mutated in order, so the tests run serially.
  test.describe.configure({ mode: "serial" });
  const backend = () => createBackendClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  let roleId = "";

  test.beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_CONVEX_URL) return;
    const client = backend();
    roleId = String(await client.mutation(api.access.createRole, {
      siteSlug: SITE, name: ROLE_NAME, includePathPatterns: ["private/*"],
    }));
    for (const target of targets) {
      const passwordSalt = createPasswordSalt();
      await client.mutation(api.users.create, {
        siteSlug: SITE, email: target.email, name: target.name,
        passwordSalt, passwordHash: hashPassword(crypto.randomUUID(), passwordSalt),
      });
    }
  });

  test.afterAll(async () => {
    if (!process.env.NEXT_PUBLIC_CONVEX_URL) return;
    const client = backend();
    try {
      const users = await client.query(api.access.listUsersWithRoles, { siteSlug: SITE });
      const ids = users.filter((user) => targets.some((t) => t.email === user.email)).map((user) => user._id);
      if (ids.length) await client.mutation(api.access.deleteUsers, { siteSlug: SITE, userIds: ids });
      if (roleId) await client.mutation(api.access.deleteRole, { siteSlug: SITE, roleId: roleId as never });
    } catch {
      // Best-effort cleanup on a disposable local stack.
    }
  });

  test.beforeEach(async ({ page }) => passGate(page));

  const roleSelect = (page: Page, name: string) => page.getByLabel(`Role for ${name}`, { exact: true });

  test("an admin changes a user's role in the users table and it persists after reload", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

    const select = roleSelect(page, targets[0].name);
    await expect(select).toBeVisible();
    await expect(select).not.toHaveValue(roleId);
    await select.selectOption(roleId);

    // Autosave: wait for the write to land on the server before reloading.
    await expect.poll(async () => {
      const users = await backend().query(api.access.listUsersWithRoles, { siteSlug: SITE });
      return users.find((user) => user.email === targets[0].email)?.roleIds.map(String);
    }).toEqual([roleId]);

    await page.reload();
    await expect(roleSelect(page, targets[0].name)).toHaveValue(roleId);
  });

  test("an admin bulk-assigns a role to several users and deletes them", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/admin/users");
    const [, second, third] = targets;
    await expect(page.getByLabel(`Select ${second.name}`, { exact: true })).toBeVisible();

    await page.getByLabel(`Select ${second.name}`, { exact: true }).check();
    await page.getByLabel(`Select ${third.name}`, { exact: true }).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByLabel("Role for selected users").selectOption(roleId);
    await page.getByRole("button", { name: "Assign role" }).click();

    await page.reload();
    await expect(roleSelect(page, second.name)).toHaveValue(roleId);
    await expect(roleSelect(page, third.name)).toHaveValue(roleId);

    await page.getByLabel(`Select ${second.name}`, { exact: true }).check();
    await page.getByLabel(`Select ${third.name}`, { exact: true }).check();
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete selected users" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText(second.email)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    await expect(page.getByText(second.email)).toHaveCount(0);
    await expect(page.getByText(third.email)).toHaveCount(0);
    // The first user (not selected) is still there.
    await expect(roleSelect(page, targets[0].name)).toBeVisible();
  });

  test("a non-admin cannot open the admin area", async ({ page }) => {
    await signIn(page, READER);
    await page.goto("/admin/users");
    // The admin page bounces non-admins to the reader home; the API refuses them too.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("complementary", { name: "Admin" })).toHaveCount(0);
    await expect(page.getByLabel(/^Role for /)).toHaveCount(0);
    const api = await page.request.get("/api/admin/access?view=users");
    expect(api.ok(), "admin API for a non-admin").toBeFalsy();
  });
});
