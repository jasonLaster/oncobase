import { createRequire } from "node:module";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { assertPrivate, createFixtureSite, gatedContext, requireLocalStack, signedInContext, SITE_SLUG } from "./helpers";

// P11 for assets: the manifest carries each image's and PDF's stored hash, so
// rendered markdown and PDF links request `/api/file?...&v=<hash>`. A matching
// `v` caches for a year; republishing the asset changes its hash and so its
// URL; a stale `v` is answered as before, without the long cache.
requireLocalStack();

const require = createRequire(import.meta.url);
const { api } = require("../../convex/_generated/api.js") as typeof import("../../convex/_generated/api");
const { createBackendClient } = require("../../server/backend-client.ts") as typeof import("../../server/backend-client");

const CARE = { email: "care@local.test", password: "local-care-password" };
const YEAR = "private, max-age=31536000, immutable";
// A real seeded image (the fixture's `![[treatment-timeline.png]]` embed resolves elsewhere and 404s).
const SEEDED_IMAGE = "wiki/images/treatment-timeline.png";
const PUBLIC_PDF = "wiki/logistics/insurance-card.pdf";

const convex = createBackendClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const fixtures = createFixtureSite();
const { nonce } = fixtures;
// A per-run image that reuses the seeded image's bytes, so republishing it
// with a new hash never touches seeded rows.
const IMAGE = `wiki/images/contract-${nonce}.png`;
// Nested like the other contract fixtures: root-level pages would show in other
// specs' navigation slices, whose slug list is cached past this run's teardown.
const PAGE = `sources/contract-${nonce}/assets`;
const LANDING = `sources/contract-${nonce}/assets-landing`;
let blobUrl = "";

async function publishImage(contentHash: string) {
  await convex.mutation(api.documents.upsertFileAsset, {
    siteSlug: SITE_SLUG, path: IMAGE, blobUrl, sizeBytes: 1, contentHash, ownerSlugs: [], sensitive: false, sensitiveInclude: [],
  });
}

type Manifest = { assets: Array<{ kind: string; path: string; contentHash: string | null }>; compactTree: unknown[] };
async function manifest(context: APIRequestContext, scope: "public" | "session" = "public") {
  const response = await context.get(`/api/wiki/manifest?scope=${scope}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Manifest;
}
const hashOf = (body: Manifest, path: string) => body.assets.find(asset => asset.path === path)?.contentHash ?? null;
// The snapshot rebuilds asynchronously after a change.
const waitForHash = (context: APIRequestContext, path: string, hash: string, scope: "public" | "session" = "public") =>
  expect.poll(async () => hashOf(await manifest(context, scope), path), { message: `${scope} manifest lists ${path} at ${hash}`, timeout: 30_000 }).toBe(hash);
const fileUrl = (path: string, v?: string) => `/api/file?path=${encodeURIComponent(path)}${v ? `&v=${encodeURIComponent(v)}` : ""}`;

test.beforeAll(async () => {
  const seeded = await convex.query(api.documents.getFileAssetByPath, { siteSlug: SITE_SLUG, path: SEEDED_IMAGE, includeSensitive: true });
  expect(seeded?.blobUrl, "seeded image row").toBeTruthy();
  blobUrl = seeded!.blobUrl;
  await publishImage(`${nonce}-a`);
  await fixtures.document({ slug: PAGE, title: `Contract assets ${nonce}`,
    content: `# Contract assets\n\n![chart](/${IMAGE})\n\n[[${PUBLIC_PDF}]]\n` });
  await fixtures.document({ slug: LANDING, title: `Contract assets landing ${nonce}`,
    content: `# Landing\n\n[Open the chart page](/${PAGE})\n` });
});
test.afterAll(async () => {
  await convex.mutation(api.documents.deleteFileAssetByPath, { siteSlug: SITE_SLUG, path: IMAGE }).catch(() => undefined);
  await fixtures.dispose();
});

test.setTimeout(90_000);

test("versioned images: immutable on a match, a new URL after republishing, no long cache for a stale v", async ({ baseURL }) => {
  const gated = await gatedContext(baseURL!);
  const care = await signedInContext(baseURL!, CARE);
  try {
    // The seeded image and PDF are listed with their stored hashes; images stay out of the file tree.
    // (Until the snapshot rebuilds after this run's fixtures, the live fallback lists PDFs only.)
    await expect.poll(async () => hashOf(await manifest(gated), SEEDED_IMAGE), { message: "seeded image hash", timeout: 30_000 }).toBeTruthy();
    const listed = await manifest(gated);
    const seededHash = hashOf(listed, SEEDED_IMAGE);
    expect(hashOf(listed, PUBLIC_PDF), "PDF hash").toBeTruthy();
    expect(JSON.stringify(listed.compactTree)).not.toContain("treatment-timeline");
    const seeded = await gated.get(fileUrl(SEEDED_IMAGE, seededHash!));
    expect(seeded.status()).toBe(200);
    expect(seeded.headers()["content-type"]).toBe("image/png");
    expect(seeded.headers()["cache-control"]).toBe(YEAR);
    expect(seeded.headers()["x-wiki-version"]).toBe("match");

    const first = `${nonce}-a`;
    await waitForHash(gated, IMAGE, first);
    const versioned = await gated.get(fileUrl(IMAGE, first));
    expect(versioned.status()).toBe(200);
    expect(versioned.headers()["cache-control"]).toBe(YEAR);
    expect(versioned.headers().etag).toBe(`"${first}"`);
    expect(versioned.headers().vary).toContain("Cookie");

    // Republish the asset with new bytes: the manifest names a new hash, so a new URL.
    const second = `${nonce}-b`;
    await publishImage(second);
    await waitForHash(gated, IMAGE, second);
    // Signed-in manifests take public images from the same snapshot.
    await waitForHash(care, IMAGE, second, "session");
    expect(fileUrl(IMAGE, second)).not.toBe(fileUrl(IMAGE, first));
    const fresh = await gated.get(fileUrl(IMAGE, second));
    expect(fresh.headers()["cache-control"]).toBe(YEAR);
    expect(fresh.headers()["x-wiki-version"]).toBe("match");

    // The old URL is answered as unversioned: no year-long cache.
    const stale = await gated.get(fileUrl(IMAGE, first));
    expect(stale.status()).toBe(200);
    assertPrivate(stale, "stale image v");
    expect(stale.headers()["x-wiki-version"]).toBe("mismatch");
    expect(stale.headers().etag).toBe(`"${second}"`);
    assertPrivate(await gated.get(fileUrl(IMAGE)), "unversioned image");

    for (const response of [seeded, versioned, fresh]) expect(response.headers()["cache-control"]).not.toContain("public");
  } finally {
    await Promise.all([gated.dispose(), care.dispose()]);
  }
});

test("rendered markdown images and PDF links use the versioned URL", async ({ page }) => {
  const login = await page.request.post("/api/login", { data: { password: "diana" } });
  expect(login.ok()).toBeTruthy();
  const imageHash = `${nonce}-b`;
  await publishImage(imageHash);
  await waitForHash(page.request, IMAGE, imageHash);
  const pdfHash = hashOf(await manifest(page.request), PUBLIC_PDF);
  const imageResponses: Array<{ url: string; cacheControl: string | undefined }> = [];
  page.on("response", response => {
    if (response.url().includes(encodeURIComponent(IMAGE))) imageResponses.push({ url: response.url(), cacheControl: response.headers()["cache-control"] });
  });

  // Arrive elsewhere so the manifest (with its hashes) is in the store before the image mounts.
  await page.goto(`/${LANDING}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "true", { timeout: 30_000 });
  await page.locator(".wiki-markdown a", { hasText: "Open the chart page" }).click();
  await expect(page).toHaveURL(new RegExp(`/${PAGE}$`));

  const image = page.locator(".wiki-markdown img[alt='chart']");
  await expect(image).toHaveAttribute("src", `/api/file?path=${encodeURIComponent(IMAGE)}&v=${encodeURIComponent(imageHash)}`);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(imageResponses.at(-1)?.cacheControl).toBe(YEAR);

  const pdfLink = page.locator(".wiki-markdown a[href*='insurance-card.pdf']").first();
  await expect(pdfLink).toHaveAttribute("href", new RegExp(`&v=${pdfHash}$`));
  // Opening it in the browser keeps v through the viewer redirect.
  const opened = await page.request.get((await pdfLink.getAttribute("href"))!, { headers: { Accept: "text/html" }, maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  expect(opened.headers().location).toBe(`/tools/pdf-viewer?path=${encodeURIComponent(PUBLIC_PDF)}&v=${pdfHash}`);
});
