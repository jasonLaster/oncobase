import { expect, test, type APIRequestContext } from "@playwright/test";
import { assertPrivate, gatedContext, requireLocalStack, signedInContext } from "./helpers";

// P11: content-addressed private reads. `?v=<contentHash>` earns a year-long
// private cache only when it is exactly what this requester may read now;
// everything else is answered as before. Sign-out clears the HTTP cache.
requireLocalStack();

const CARE = { email: "care@local.test", password: "local-care-password" };
const READER = { email: "reader@local.test", password: "local-reader-password" };
const PRIVATE_SLUG = "private/care-team-notes";
const PRIVATE_PDF = "private/lab-report.pdf";
const PUBLIC_PDF = "wiki/logistics/insurance-card.pdf";
const YEAR = "private, max-age=31536000, immutable";

type Manifest = { pages: Array<{ slug: string; contentHash: string | null }> };
async function manifest(context: APIRequestContext, scope: "public" | "session") {
  const response = await context.get(`/api/wiki/manifest?scope=${scope}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Manifest;
}
const pageUrl = (slug: string, v?: string) => `/api/wiki/pages?scope=session&slugs=${encodeURIComponent(slug)}${v ? `&v=${encodeURIComponent(v)}` : ""}`;
const fileUrl = (path: string, v?: string) => `/api/file?path=${encodeURIComponent(path)}${v ? `&v=${encodeURIComponent(v)}` : ""}`;

test("versioned pages and files: long private cache only for a validated v", async ({ baseURL }) => {
  const gated = await gatedContext(baseURL!);
  const care = await signedInContext(baseURL!, CARE);
  const reader = await signedInContext(baseURL!, READER);
  try {
    const careManifest = await manifest(care, "session");
    const pageHash = careManifest.pages.find(page => page.slug === PRIVATE_SLUG)?.contentHash;
    // The file's ETag is its stored content hash, the value `v` names (the
    // manifest carries the same hash; versioned-assets.spec.ts covers that).
    const etagHash = async (context: APIRequestContext, path: string) =>
      (await context.get(fileUrl(path))).headers().etag?.replace(/"/g, "");
    const privatePdfHash = await etagHash(care, PRIVATE_PDF);
    const publicPdfHash = await etagHash(gated, PUBLIC_PDF);
    expect(pageHash, "manifest page hash").toBeTruthy();
    expect(privatePdfHash, "private asset hash").toBeTruthy();
    expect(publicPdfHash, "public asset hash").toBeTruthy();

    // Pages.
    const versioned = await care.get(pageUrl(PRIVATE_SLUG, pageHash!));
    expect(versioned.headers()["cache-control"]).toBe(YEAR);
    expect(versioned.headers()["x-wiki-version"]).toBe("match");
    expect(versioned.headers().vary).not.toContain("Cookie");
    expect((await versioned.json()).pages[0].slug).toBe(PRIVATE_SLUG);
    assertPrivate(await care.get(pageUrl(PRIVATE_SLUG)), "unversioned page");
    const stale = await care.get(pageUrl(PRIVATE_SLUG, "0".repeat(64)));
    assertPrivate(stale, "mismatched page v");
    expect(stale.headers()["x-wiki-version"]).toBe("mismatch");
    // The care team's URL, asked by a reader without a role: today's stub, no cache.
    const refused = await reader.get(pageUrl(PRIVATE_SLUG, pageHash!));
    assertPrivate(refused, "unauthorized page v");
    const refusedBody = await refused.json();
    expect(refusedBody.pages).toEqual([]);
    expect(refusedBody.unavailable?.[0]?.slug).toBe(PRIVATE_SLUG);
    expect(JSON.stringify(refusedBody)).not.toContain("Next oncology visit");

    // Files.
    const pdf = await gated.get(fileUrl(PUBLIC_PDF, publicPdfHash!));
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["cache-control"]).toBe(YEAR);
    expect(pdf.headers().etag).toBe(`"${publicPdfHash}"`);
    const plainPdf = await gated.get(fileUrl(PUBLIC_PDF));
    assertPrivate(plainPdf, "unversioned file");
    expect(plainPdf.headers().etag).toBe(`"${publicPdfHash}"`);
    const revalidated = await gated.get(fileUrl(PUBLIC_PDF), { headers: { "If-None-Match": `"${publicPdfHash}"` } });
    expect(revalidated.status()).toBe(304);
    assertPrivate(await gated.get(fileUrl(PUBLIC_PDF, "stale")), "mismatched file v");

    const privatePdf = await care.get(fileUrl(PRIVATE_PDF, privatePdfHash!));
    expect(privatePdf.status()).toBe(200);
    expect(privatePdf.headers()["cache-control"]).toBe(YEAR);
    for (const [label, context] of [["gate-only", gated], ["no role", reader]] as const) {
      const denied = await context.get(fileUrl(PRIVATE_PDF, privatePdfHash!));
      expect(denied.status(), label).toBe(404);
      assertPrivate(denied, `${label} file v`);
    }

    // Nothing from the gated site is ever public.
    for (const response of [versioned, pdf, privatePdf]) expect(response.headers()["cache-control"]).not.toContain("public");
  } finally {
    await Promise.all([gated.dispose(), care.dispose(), reader.dispose()]);
  }
});

test("sign-out clears the browser's HTTP cache for the site", async ({ baseURL }) => {
  const care = await signedInContext(baseURL!, CARE);
  try {
    const response = await care.post("/api/auth/signout");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["clear-site-data"]).toBe('"cache"');
    assertPrivate(response, "sign-out");
  } finally {
    await care.dispose();
  }
});
