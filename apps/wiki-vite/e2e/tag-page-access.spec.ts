import crypto from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { createRequire } from "node:module";

const { api } = createRequire(import.meta.url)(
  "../../web/convex/_generated/api.js",
) as typeof import("../../web/convex/_generated/api");
const { cleanupSiteUsers } = createRequire(import.meta.url)(
  "../../web/e2e/helpers.ts",
) as typeof import("../../web/e2e/helpers");

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const RUN_NONCE = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const SITE_SLUG = `vite-tag-page-${RUN_NONCE}`;
const SITE_HOST = `${SITE_SLUG}.localhost`;
const OWNER_EMAIL = `owner-${RUN_NONCE}@example.test`;
const NORMAL_EMAIL = `normal-${RUN_NONCE}@example.test`;
const PASSWORD = "correct horse battery";
const TAG = `serova-vite-${RUN_NONCE}`;
const PUBLIC_SLUG = `sources/research/${TAG}-public`;
const ALLOWED_SLUG = `sources/meeting-notes/${TAG}-allowed`;
const DENIED_SLUG = `sources/private/${TAG}-denied`;
const PUBLIC_TITLE = "Serova Public Tag Fixture";
const ALLOWED_TITLE = "Serova Sensitive Meeting Note Fixture";
const DENIED_TITLE = "Serova Denied Sensitive Fixture";

function tokenHash() {
  const token = `wpt_${crypto.randomBytes(24).toString("base64url")}`;
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function siteBaseURL(baseURL: string) {
  const url = new URL(baseURL);
  url.hostname = SITE_HOST;
  return url.toString().replace(/\/$/, "");
}

async function signUp(context: BrowserContext, email: string) {
  const response = await context.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD, name: email.split("@")[0] },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.describe("Vite tag page access", () => {
  test.setTimeout(90_000);
  test.skip(!CONVEX_URL, "Requires NEXT_PUBLIC_CONVEX_URL for the target Convex deployment.");

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
        slug: PUBLIC_SLUG,
        title: PUBLIC_TITLE,
        content: "Public Serova tag page fixture.",
        tags: [TAG, "serova"],
        contentHash: `${RUN_NONCE}-public`,
        sensitive: false,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: ALLOWED_SLUG,
        title: ALLOWED_TITLE,
        content: "Sensitive meeting-note fixture assigned users should see.",
        tags: [TAG, "serova"],
        sensitiveInclude: ["serova"],
        contentHash: `${RUN_NONCE}-allowed`,
        sensitive: true,
      }),
      convex.mutation(api.documents.upsert, {
        siteSlug: SITE_SLUG,
        slug: DENIED_SLUG,
        title: DENIED_TITLE,
        content: "Sensitive fixture only admin users should see.",
        tags: [TAG, "serova"],
        sensitiveInclude: ["serova"],
        contentHash: `${RUN_NONCE}-denied`,
        sensitive: true,
      }),
    ]);
  });

  test.afterAll(async () => {
    if (!convex) return;
    try {
      await Promise.all(
        [PUBLIC_SLUG, ALLOWED_SLUG, DENIED_SLUG].map((slug) =>
          convex.mutation(api.documents.deleteBySlug, { siteSlug: SITE_SLUG, slug }),
        ),
      );
      await cleanupSiteUsers(convex, SITE_SLUG);
      await convex.mutation(api.sites.archive, { slug: SITE_SLUG });
    } catch {
      // Best-effort cleanup for local and CI runs.
    }
  });

  test("filters tagged pages for logged out, normal, and owner users", async ({
    baseURL,
    browser,
  }) => {
    const url = siteBaseURL(baseURL ?? "http://localhost:61001");
    const anonymousContext = await browser.newContext({
      baseURL: url,
      storageState: { cookies: [], origins: [] },
    });
    const normalContext = await browser.newContext({
      baseURL: url,
      storageState: { cookies: [], origins: [] },
    });
    const ownerContext = await browser.newContext({
      baseURL: url,
      storageState: { cookies: [], origins: [] },
    });

    try {
      await signUp(normalContext, NORMAL_EMAIL);
      await signUp(ownerContext, OWNER_EMAIL);

      const [normalAccount, ownerAccount] = await Promise.all([
        convex.query(api.users.getByEmailForAuth, { siteSlug: SITE_SLUG, email: NORMAL_EMAIL }),
        convex.query(api.users.getByEmailForAuth, { siteSlug: SITE_SLUG, email: OWNER_EMAIL }),
      ]);
      expect(normalAccount).toBeTruthy();
      expect(ownerAccount).toBeTruthy();

      const [meetingNotesRoleId, privateRoleId] = await Promise.all([
        convex.mutation(api.access.createRole, {
          siteSlug: SITE_SLUG,
          name: "Serova meeting-note reader",
          includePathPatterns: ["sources/meeting-notes/*"],
          includeTags: [TAG],
        }),
        convex.mutation(api.access.createRole, {
          siteSlug: SITE_SLUG,
          name: "Serova private reader",
          includePathPatterns: [DENIED_SLUG],
        }),
      ]);

      await Promise.all([
        convex.mutation(api.access.assignRoleToUser, {
          siteSlug: SITE_SLUG,
          userId: normalAccount!._id,
          roleId: meetingNotesRoleId,
        }),
        convex.mutation(api.access.assignRoleToUser, {
          siteSlug: SITE_SLUG,
          userId: ownerAccount!._id,
          roleId: meetingNotesRoleId,
        }),
        convex.mutation(api.access.assignRoleToUser, {
          siteSlug: SITE_SLUG,
          userId: ownerAccount!._id,
          roleId: privateRoleId,
        }),
      ]);

      const anonymousPage = await anonymousContext.newPage();
      await anonymousPage.goto(`/tags/${TAG}?scope=public`, { waitUntil: "domcontentloaded" });
      await expect(anonymousPage.getByRole("heading", { name: `Tag: ${TAG}` })).toBeVisible();
      await expect(anonymousPage.getByText("1 page")).toBeVisible();
      await expect(anonymousPage.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
      await expect(anonymousPage.getByRole("link", { name: ALLOWED_TITLE })).toHaveCount(0);
      await expect(anonymousPage.getByRole("link", { name: DENIED_TITLE })).toHaveCount(0);

      const normalPage = await normalContext.newPage();
      await normalPage.goto(`/tags/${TAG}?scope=session`, { waitUntil: "domcontentloaded" });
      await expect(normalPage.getByText("2 pages")).toBeVisible();
      await expect(normalPage.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
      await expect(normalPage.getByRole("link", { name: ALLOWED_TITLE })).toBeVisible();
      await expect(normalPage.getByRole("link", { name: DENIED_TITLE })).toHaveCount(0);

      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`/tags/${TAG}?scope=session`, { waitUntil: "domcontentloaded" });
      await expect(ownerPage.getByText("3 pages")).toBeVisible();
      await expect(ownerPage.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
      await expect(ownerPage.getByRole("link", { name: ALLOWED_TITLE })).toBeVisible();
      await expect(ownerPage.getByRole("link", { name: DENIED_TITLE })).toBeVisible();
    } finally {
      void anonymousContext.close().catch(() => {});
      void normalContext.close().catch(() => {});
      void ownerContext.close().catch(() => {});
    }
  });
});
