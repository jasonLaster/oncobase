import { writeFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";
import { installVisualStabilityObserver, type VisualStabilityReport } from "../src/visual-stability";

const first = "wiki/logistics/insurance";
const second = "sources/people/providers/stanford/telli";
const refreshEvent = "wiki-vite:refresh-manifest";
const read = (page: Page) => page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report());
async function settle(page: Page) {
  // Observe late effects and resource completions after readiness assertions.
  await page.waitForTimeout(700);
}
async function reset(page: Page) {
  await page.evaluate(async () => {
    window.__WIKI_VISUAL_STABILITY__!.reset();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
function assertContinuity(report: VisualStabilityReport, geometry = true) {
  expect(report.frames).toBeGreaterThan(1);
  expect(report.seen).toEqual(expect.arrayContaining(["heading", "body"]));
  expect(report.counts.disappearance ?? 0, JSON.stringify(report.events)).toBe(0);
  expect(report.counts["content-cleared"] ?? 0).toBe(0);
  if (geometry) {
    expect(report.counts.geometry ?? 0, JSON.stringify(report.events.filter((event) => event.kind === "geometry"))).toBe(0);
    if (report.cls !== null) expect(report.cls).toBeLessThanOrEqual(0.01);
  }
}

test.beforeEach(async ({ page, browserName }) => {
  await page.addInitScript(installVisualStabilityObserver);
  const rate = Number(process.env.VISUAL_CPU_RATE ?? 1);
  if (browserName === "chromium" && rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
});
test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  const report = await read(page).catch(() => null);
  if (report) {
    const path = testInfo.outputPath("visual-stability.json");
    await writeFile(path, JSON.stringify(report, null, 2));
    await testInfo.attach("visual-stability", { path, contentType: "application/json" });
  }
  if (process.env.VISUAL_SCREENSHOTS === "1") await page.screenshot({ path: testInfo.outputPath("final-frame.png") });
});

test("long title, tags and a table retain their layout through delayed body loading", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWikiApiMocks(page, {
    pageDelays: { [first]: 900 },
    pageOverrides: { [first]: {
      title: "Planning appointments and insurance coverage across multiple care teams",
      tags: ["logistics", "insurance", "planning"],
      content: "# Planning appointments and insurance coverage across multiple care teams\n\nA static explanation.\n\n| Appointment | Status |\n| --- | --- |\n| Consultation | Planned |\n| Follow-up | Pending |",
    } },
  });
  await gotoWiki(page, `/${first}`);
  await expect(documentArticle(page).locator("table")).toBeVisible();
  await settle(page);
  assertContinuity(await read(page));
});

for (const width of [360, 768, 1024, 1440]) {
  test(`slow cold static page stays stable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installWikiApiMocks(page, { pageDelays: { [first]: 800 } });
    await gotoWiki(page, `/${first}?paintDebug=1`);
    await settle(page);
    assertContinuity(await read(page));
  });
}

for (const outcome of ["unchanged", "updated", "failed"] as const) {
  test(`cached content survives ${outcome} background refresh`, async ({ page }) => {
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, `/${first}`);
    await settle(page);
    requests.setManifestDelay(600);
    if (outcome === "failed") requests.setManifestFailure(true);
    if (outcome === "updated") requests.setPageOverride(first, { content: "# Insurance\n\nThis page covers authorization, coverage notes, and practical logistics.\n\n## Prior authorization\n\nUpdated guidance is available.\n\n## Claims follow-up\n\nAdditional details." });
    await reset(page);
    const response = page.waitForResponse((response) => response.url().includes("/api/wiki/manifest"));
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), refreshEvent);
    await response;
    if (outcome === "updated") await expect(documentArticle(page)).toContainText("Updated guidance");
    await settle(page);
    assertContinuity(await read(page));
  });
}

for (const preference of ["narrow", "collapsed", "outline"] as const) {
test(`saved first frame uses current ${preference} preference after another tab changes it`, async ({ page }) => {
  await installWikiApiMocks(page);
  await gotoWiki(page, `/${first}`);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("wiki-vite:first-frame:")))).toBe(true);
  // Equivalent to another tab saving a narrower sidebar after this snapshot.
  await page.evaluate((preference) => {
    if (preference === "outline") {
      localStorage.setItem("comments-pane-open", "1");
      localStorage.setItem("comments-pane-width", "300");
    } else localStorage.setItem("sidebar-width", preference === "collapsed" ? "0" : "192");
  }, preference);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("#wiki-first-frame-snapshot")).toBeVisible();
    await page.waitForTimeout(100);
  } finally { release(); }
  await expect(page.locator("#wiki-first-frame-snapshot").filter({ visible: true })).toHaveCount(0);
  await waitForPageTitle(page, "Insurance");
  await settle(page);
  assertContinuity(await read(page));
});
}

test("late authenticated identity hands the public snapshot to the session reader", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  await gotoWiki(page, `/${first}?scope=public`);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("wiki-vite:first-frame:")))).toBe(true);
  requests.setSessionAuthenticated(true);
  requests.setPageOverride(first, { content: "# Insurance\n\nSESSION_ONLY_SENTINEL" });
  await page.route("**/api/wiki/session**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fallback();
  });
  await page.goto(`/${first}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#wiki-first-frame-snapshot").filter({ visible: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WIKI_VISUAL_STABILITY__!.report().events.some((event) => event.kind === "phase:identity-ready" && event.data?.scope === "session"))).toBe(true);
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("SESSION_ONLY_SENTINEL");
  await settle(page);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("wiki-vite:first-frame:"))
    .some((key) => localStorage.getItem(key)?.includes("SESSION_ONLY_SENTINEL")))).toBe(false);
  assertContinuity(await read(page));
});

for (const mode of ["warm", "slow"] as const) {
  test(`${mode} navigation and browser history retain readable content`, async ({ page }) => {
    await installWikiApiMocks(page, {
      pageDelays: { [second]: mode === "slow" ? 1000 : 0 },
      pageOverrides: { [first]: { content: `# Insurance\n\nReadable source content.\n\n[Next document](/${second})` } },
    });
    if (mode === "warm") await gotoWiki(page, `/${second}`);
    await gotoWiki(page, `/${first}`);
    await settle(page);
    await reset(page);
    await documentArticle(page).getByRole("link", { name: "Next document" }).click();
    await waitForPageTitle(page, "Telli");
    await page.goBack();
    await waitForPageTitle(page, "Insurance");
    await settle(page);
    assertContinuity(await read(page), false);
    expect((await read(page)).events.filter((event) => event.kind === "geometry" && event.region === "navigation")).toEqual([]);
  });
}

for (const homeRoute of ["/", "/about/Index"]) {
  test(`navigation from ${homeRoute} preserves the displayed page layout until the body is ready`, async ({ page }) => {
    await installWikiApiMocks(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/wiki/pages**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("slugs")?.split(",").includes(first)) await held;
      await route.fallback();
    });
    await gotoWiki(page, homeRoute);
    const body = documentArticle(page).locator(".wiki-markdown");
    const previousText = await body.textContent();
    const before = await body.boundingBox();
    try {
      await documentArticle(page).getByRole("link", { name: "Insurance", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(first));
      await expect(body).toHaveText(previousText!);
      await settle(page);
      expect((await body.boundingBox())!.y).toBe(before!.y);
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
    } finally { release(); }
    await waitForPageTitle(page, "Insurance");
  });
}

test("failed navigation leaves a bounded retry state and recovers", async ({ page }) => {
  const requests = await installWikiApiMocks(page, {
    pageFailures: { [second]: true },
    pageOverrides: { [first]: { content: `# Insurance\n\nReadable source content.\n\n[Next document](/${second})` } },
  });
  await gotoWiki(page, `/${first}`);
  await documentArticle(page).getByRole("link", { name: "Next document" }).click();
  await expect(page.getByTestId("retry-page-fetch")).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  requests.setPageFailure(second, 0);
  await page.getByTestId("retry-page-fetch").click();
  await waitForPageTitle(page, "Telli");
  await expect(documentArticle(page).locator(".wiki-markdown")).toBeVisible();
});

for (const dimensions of [{ name: "landscape", width: 800, height: 450 }, { name: "portrait", width: 400, height: 800 }]) {
test(`delayed ${dimensions.name} image decode does not move text below the image`, async ({ page }) => {
  await installWikiApiMocks(page, { pageOverrides: {
    [first]: { content: "# Insurance\n\nBefore the image.\n\n![Delayed figure](https://fixtures.invalid/stability-figure.svg)\n\nAFTER_IMAGE_ANCHOR" },
  } });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/stability-figure.svg", async (route) => {
    await held;
    await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}"><rect width="100%" height="100%" fill="#567"/></svg>` });
  });
  let before = 0;
  try {
    await gotoWiki(page, `/${first}`);
    await settle(page);
    before = (await page.getByText("AFTER_IMAGE_ANCHOR", { exact: true }).boundingBox())!.y;
    await reset(page);
  } finally { release(); }
  // WebKit can report the SVG's CSS-resolved intrinsic width. The contract is
  // successful decode followed by unchanged layout, not an engine-specific size.
  await expect.poll(() => page.getByAltText("Delayed figure").evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await settle(page);
  const after = (await page.getByText("AFTER_IMAGE_ANCHOR", { exact: true }).boundingBox())!.y;
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  assertContinuity(await read(page));
});
}

test("temporary storage fallback does not retract already-visible content", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.storage.getDirectory = async () => { throw new DOMException("Denied", "SecurityError"); };
  });
  await installWikiApiMocks(page);
  await gotoWiki(page, `/${first}`);
  await settle(page);
  assertContinuity(await read(page));
});

test("diagnostics route keeps navigation while its lazy code loads", async ({ page }) => {
  await installWikiApiMocks(page);
  await gotoWiki(page, `/${first}`);
  await settle(page);
  await reset(page);
  await page.getByTestId("wiki-sidebar").getByRole("link", { name: "Diagnostics", exact: true }).click();
  await expect(page).toHaveURL(/\/diagnostics/);
  await settle(page);
  const report = await read(page);
  expect(report.events.filter((event) => event.region === "navigation" && ["geometry", "disappearance"].includes(event.kind))).toEqual([]);
});
