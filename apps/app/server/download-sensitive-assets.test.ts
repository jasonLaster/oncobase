// Full-site downloads must apply the same asset visibility rules as /api/file:
// a sensitive PDF/file is included only for a viewer who can read EVERY page
// that owns it, not merely when a same-named sibling page is public.
import { expect, test } from "bun:test";
import { SITE, cookieFor, createFixture, type Fixture } from "./chat-security-fixture";
import { getSessionUser } from "./reader-access";
import { listDownloadAssets } from "./api/download";

async function seedAssets(fixture: Fixture) {
  await fixture.t.run(async (ctx) => {
    const base = { siteId: fixture.ids.siteId, sizeBytes: 3, uploadedAt: 1 };
    // Sensitive because the page that embeds it is sensitive; its filename has no sibling page.
    await ctx.db.insert("pdfAssets", { ...base, path: "attachments/lab-report.pdf", blobUrl: "https://blob.test/lab", sensitive: true, ownerSlugs: ["private/care-team-notes"] });
    await ctx.db.insert("pdfAssets", { ...base, path: "attachments/other-owner.pdf", blobUrl: "https://blob.test/other", sensitive: true, ownerSlugs: ["private/unprotected"] });
    // Legacy row without visibility metadata: /api/file treats this as sensitive.
    await ctx.db.insert("fileAssets", { ...base, path: "attachments/legacy.csv", blobUrl: "https://blob.test/legacy" });
    // Flagged public itself, but a same-named page is sensitive (the pre-existing sibling rule).
    await ctx.db.insert("pdfAssets", { ...base, path: "private/care-team-notes.pdf", blobUrl: "https://blob.test/sibling", sensitive: false, ownerSlugs: [] });
    await ctx.db.insert("fileAssets", { ...base, path: "attachments/public.csv", blobUrl: "https://blob.test/public", sensitive: false, ownerSlugs: ["wiki/public-note"] });
  });
}

async function downloadable(fixture: Fixture, viewer: "anonymous" | "reader" | "care") {
  const request = new Request("http://127.0.0.1/api/download?type=full", { headers: { cookie: cookieFor(fixture, viewer) } });
  const user = await getSessionUser(request, fixture.client, SITE);
  return (await listDownloadAssets(fixture.client, SITE, Boolean(user), user, Number.POSITIVE_INFINITY)).map((asset) => asset.path).sort();
}

test("download archives omit sensitive assets the viewer cannot read, matching /api/file", async () => {
  const fixture = await createFixture();
  await seedAssets(fixture);
  expect(await downloadable(fixture, "anonymous")).toEqual(["attachments/public.csv"]);
  // A signed-in user with no role gets only public assets.
  expect(await downloadable(fixture, "reader")).toEqual(["attachments/public.csv"]);
  // The role holder gets the asset owned by a page they can read, not the one owned by a page no role grants,
  // and not the legacy row with no visibility metadata (which /api/file also refuses).
  expect(await downloadable(fixture, "care")).toEqual(["attachments/lab-report.pdf", "attachments/public.csv", "private/care-team-notes.pdf"]);
});
