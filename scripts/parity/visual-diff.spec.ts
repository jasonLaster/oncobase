import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import { diffManifests, fetchManifest, type WikiManifest } from "./manifest-diff";

const LEGACY_ORIGIN = process.env.PARITY_LEGACY_ORIGIN || "https://diana-tnbc.com";
const VITE_ORIGIN = process.env.PARITY_VITE_ORIGIN || process.env.PLAYWRIGHT_BASE_URL || "https://wiki-vite-zeta.vercel.app";
const PASSWORD = process.env.PARITY_LOGIN_PASSWORD || process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD || "";
const COOKIE_HEADER = process.env.PARITY_COOKIE_HEADER || "";
const SLUG_LIMIT = Number(process.env.PARITY_VISUAL_LIMIT || 0);
const OUTPUT_DIR = process.env.PARITY_VISUAL_OUTPUT_DIR || path.join("test-results", "parity-visual");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function pagePath(slug: string) {
  return `/${slug === "index" ? "" : slug}`;
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "index";
}

async function login(page: Page, origin: string) {
  if (COOKIE_HEADER) {
    await page.context().addCookies(
      COOKIE_HEADER.split(/;\s*/)
        .map((part) => part.split("="))
        .filter(([name, value]) => name && value)
        .map(([name, value]) => ({
          name: name!,
          value: value!,
          url: origin,
          httpOnly: true,
          sameSite: "Lax" as const,
        })),
    );
    return;
  }

  if (!PASSWORD) return;
  const response = await page.request.post(new URL("/api/login", origin).toString(), {
    data: { password: PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`Login failed for ${origin}: ${response.status()} ${await response.text()}`);
  }
  const storage = await page.request.storageState();
  await page.context().addCookies(storage.cookies.filter((cookie) => cookie.domain));
}

async function openCapturePage(browser: Browser, origin: string, viewport: typeof VIEWPORTS[number]) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
  });
  const page = await context.newPage();
  await login(page, origin);
  return { context, page };
}

async function capture(page: Page, slug: string) {
  // networkidle never settles on the vite reader (LiveStore keeps sync
  // connections open); wait for rendered content plus a short settle instead.
  await page.goto(pagePath(slug), { waitUntil: "domcontentloaded" });
  await page
    .locator(".page-header h1, .page-shell h1, article h1")
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {});
  await page
    .getByText(/^Loading markdown for/)
    .waitFor({ state: "hidden", timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(750);
  return page.screenshot({
    fullPage: true,
    animations: "disabled",
    mask: [
      page.locator(".metrics-panel"),
      page.locator(".topbar-status"),
      page.locator(".page-footer"),
    ],
  });
}

function selectedSlugs(manifest: WikiManifest) {
  const slugs = manifest.pages.map((page) => page.slug).sort((a, b) => a.localeCompare(b));
  return SLUG_LIMIT > 0 ? slugs.slice(0, SLUG_LIMIT) : slugs;
}

async function writeReport(rows: Array<{
  slug: string;
  viewport: string;
  legacyFile: string;
  viteFile: string;
  byteEqual: boolean;
}>) {
  const markdown = [
    "# Visual Parity Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Legacy origin: ${LEGACY_ORIGIN}`,
    `Vite origin: ${VITE_ORIGIN}`,
    "",
    "| Slug | Viewport | Byte-identical | Legacy | Vite |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| \`${row.slug}\` | ${row.viewport} | ${row.byteEqual ? "yes" : "no"} | [legacy](${row.legacyFile}) | [vite](${row.viteFile}) |`,
    ),
    "",
  ].join("\n");

  const htmlRows = rows.map((row) => `
    <section>
      <h2>${row.slug} - ${row.viewport}</h2>
      <p>Byte-identical: ${row.byteEqual ? "yes" : "no"}</p>
      <div class="pair">
        <figure><figcaption>Legacy</figcaption><img src="${row.legacyFile}" /></figure>
        <figure><figcaption>Vite</figcaption><img src="${row.viteFile}" /></figure>
      </div>
    </section>`).join("\n");
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Visual Parity Report</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; color: #1f2937; }
      section { border-top: 1px solid #d1d5db; padding: 20px 0; }
      .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
      img { max-width: 100%; border: 1px solid #d1d5db; }
      figcaption { font-weight: 600; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <h1>Visual Parity Report</h1>
    <p>Legacy origin: ${LEGACY_ORIGIN}</p>
    <p>Vite origin: ${VITE_ORIGIN}</p>
    ${htmlRows}
  </body>
</html>`;

  await writeFile(path.join(OUTPUT_DIR, "report.md"), markdown);
  await writeFile(path.join(OUTPUT_DIR, "report.html"), html);
}

test("captures manifest-pinned visual parity report", async ({ browser }) => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const [legacyManifest, viteManifest] = await Promise.all([
    fetchManifest(LEGACY_ORIGIN, { cookieHeader: COOKIE_HEADER }),
    fetchManifest(VITE_ORIGIN, { cookieHeader: COOKIE_HEADER }),
  ]);

  const manifestDiff = diffManifests(legacyManifest, viteManifest);
  if (!manifestDiff.manifestHashEqual) {
    await writeFile(
      path.join(OUTPUT_DIR, "report.md"),
      [
        "# Visual Parity Report",
        "",
        "Aborted before screenshots because manifest hashes do not match.",
        "",
        `Legacy manifestHash: \`${legacyManifest.manifestHash}\``,
        `Vite manifestHash: \`${viteManifest.manifestHash}\``,
        "",
        "Re-run after both origins serve the same corpus manifestHash.",
        "",
      ].join("\n"),
    );
    return;
  }

  const rows: Array<{
    slug: string;
    viewport: string;
    legacyFile: string;
    viteFile: string;
    byteEqual: boolean;
  }> = [];

  const slugs = selectedSlugs(legacyManifest);
  for (const viewport of VIEWPORTS) {
    // One warm context per origin so LiveStore hydrates once, not per page.
    const legacySession = await openCapturePage(browser, LEGACY_ORIGIN, viewport);
    const viteSession = await openCapturePage(browser, VITE_ORIGIN, viewport);
    for (const slug of slugs) {
      const prefix = `${safeName(slug)}-${viewport.name}`;
      const legacyFile = `${prefix}-legacy.png`;
      const viteFile = `${prefix}-vite.png`;
      const [legacyShot, viteShot] = await Promise.all([
        capture(legacySession.page, slug),
        capture(viteSession.page, slug),
      ]);
      await writeFile(path.join(OUTPUT_DIR, legacyFile), legacyShot);
      await writeFile(path.join(OUTPUT_DIR, viteFile), viteShot);
      rows.push({
        slug,
        viewport: `${viewport.name} ${viewport.width}px`,
        legacyFile,
        viteFile,
        byteEqual: Buffer.compare(legacyShot, viteShot) === 0,
      });
    }
    await legacySession.context.close();
    await viteSession.context.close();
  }

  await writeReport(rows);
});
