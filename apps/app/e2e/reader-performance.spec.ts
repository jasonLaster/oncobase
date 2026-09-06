import { expect } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const pages = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [
  `wiki/performance/page-${String(index).padStart(4, "0")}`,
  { title: `Performance page ${index}`, content: `# Performance page ${index}\n\nSynthetic large-tree document ${index}.`, tags: ["performance"] },
]));

test("an uncached page paints an accessible shell before JavaScript arrives", async ({ page }) => {
  await installWikiApiMocks(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto("/wiki/logistics/insurance", { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "Loading page", exact: true })).toBeVisible();
    await expect(page.getByTestId("reader-boot-shell")).toHaveAttribute("aria-busy", "true");
    await expect(documentArticle(page)).toHaveCount(0);
  } finally { release(); }
  await waitForPageTitle(page, "Insurance");
  await expect(page.getByTestId("reader-boot-shell")).toHaveCount(0);
});

test("large-corpus file search can open an unmounted tree row without a search request", async ({ page }) => {
  await installWikiApiMocks(page, { pageOverrides: pages });
  let searchRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.includes("/api/wiki/search")) searchRequests++; });
  await gotoWiki(page, "/wiki/logistics/insurance");
  await page.getByTestId("sidebar-search").click();
  await page.getByTestId("command-palette-input").fill("page-0799");
  await page.getByRole("option").filter({ hasText: "0799" }).click();
  await waitForPageTitle(page, "Performance page 799");
  expect(searchRequests).toBe(0);
});

test("a delayed database worker keeps a loading state and recovers", async ({ page }) => {
  await installWikiApiMocks(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let workerPending = false;
  await page.route(/\/livestore\.worker[^/]*\.(?:js|ts)(?:\?.*)?$/, async route => {
    workerPending = true;
    await held;
    await route.fallback();
  });
  try {
    await page.goto("/wiki/logistics/insurance", { waitUntil: "domcontentloaded" });
    await expect.poll(() => workerPending).toBe(true);
    await expect(page.getByTestId("page-loading")).toBeVisible();
    await expect(documentArticle(page)).toHaveCount(0);
  } finally { release(); }
  await waitForPageTitle(page, "Insurance");
});

test("desktop and mobile auth controls share one session read per refresh", async ({ page }) => {
  await installWikiApiMocks(page);
  let reads = 0;
  await page.route("**/api/auth/session", async route => {
    reads++;
    await route.fulfill({ json: { user: null } });
  });
  await gotoWiki(page, "/wiki/logistics/insurance");
  await expect.poll(() => reads).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("bottom-nav-trigger").click();
  await expect(page.getByTestId("bottom-nav-sheet")).not.toHaveAttribute("inert", "");
  expect(reads).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("wiki-auth-session-change")));
  await expect.poll(() => reads).toBe(2);
});

test("an older session response cannot overwrite a newer auth refresh", async ({ page }) => {
  await installWikiApiMocks(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/auth/session", async route => {
    const first = ++reads === 1;
    if (first) await held;
    await route.fulfill({ json: { user: { email: "reader@example.test", name: first ? "Stale Example" : "Current Example", isAdmin: false } } });
  });
  try {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await expect.poll(() => reads).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-auth-session-change")));
    await page.getByRole("button", { name: "Workspace menu" }).click();
    const menu = page.getByRole("menu", { name: "Actions" });
    await expect(menu.getByRole("menuitem", { name: "Current Example", exact: true })).toBeVisible();
    const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session");
    release();
    await (await staleResponse).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(menu.getByRole("menuitem", { name: "Current Example", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Stale Example", exact: true })).toHaveCount(0);
  } finally { release(); }
});

test("the cold body renders without waiting for the manifest", async ({ page }) => {
  await installWikiApiMocks(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/manifest**", async route => { await held; await route.fallback(); });
  try {
    await page.goto("/wiki/logistics/insurance", { waitUntil: "domcontentloaded" });
    await expect(documentArticle(page)).toContainText("Prior authorization");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByTestId("sidebar-tree").getByRole("link", { name: "insurance", exact: true })).toBeVisible();
});

test("login loads without starting the reader database or fetching document data", async ({ page }) => {
  await page.context().clearCookies();
  const resources: string[] = [];
  page.on("request", request => resources.push(new URL(request.url()).pathname));
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  expect(resources.filter(resource => /LiveStoreRoot|livestore\.worker|wa-sqlite|\/api\/wiki\//.test(resource))).toEqual([]);
});

for (const mobile of [false, true]) {
  for (const scope of ["public", "session"]) {
    test(`${mobile ? "mobile" : "desktop"} ${scope} large tree keeps focus and every file reachable`, async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await installWikiApiMocks(page, { pageOverrides: pages, sessionAuthenticated: scope === "session" });
      await gotoWiki(page, `/wiki/logistics/insurance?scope=${scope}`);
      if (mobile) {
        await expect(page.getByTestId("bottom-nav-sheet").locator(".wiki-shell-tree-root")).toHaveCount(0);
        await page.getByTestId("bottom-nav-trigger").click();
      }
      const navigation = page.getByTestId(mobile ? "bottom-nav-page-tree" : "sidebar-tree");
      await navigation.getByRole("button", { name: "Expand performance", exact: true }).focus();
      await page.keyboard.press("Enter");
      const tree = navigation.locator(".wiki-shell-tree-root");
      await expect(tree).toHaveAttribute("data-virtualized", "true");
      const folder = navigation.getByRole("button", { name: "Collapse performance", exact: true });
      await expect(folder).toBeFocused();
      await expect.poll(() => tree.locator("[data-tree-row]").count()).toBeLessThan(90);

      await page.keyboard.press("Tab");
      await expect(navigation.getByRole("link", { name: "page 0000", exact: true })).toBeFocused();
      for (let index = 0; index < 40; index++) await page.keyboard.press("Tab");
      await expect(navigation.getByRole("link", { name: "page 0040", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(navigation.getByRole("link", { name: "page 0039", exact: true })).toBeFocused();

      await navigation.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const last = navigation.getByRole("link", { name: "page 0799", exact: true });
      await expect(last).toBeVisible();
      await last.click();
      await waitForPageTitle(page, "Performance page 799");
      if (mobile) {
        await expect(page.getByTestId("bottom-nav-sheet")).toHaveAttribute("inert", "");
        await page.getByTestId("bottom-nav-trigger").click();
      }
      await navigation.evaluate(element => { element.scrollTop = 0; });
      await navigation.getByRole("button", { name: "Collapse performance", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(navigation.getByRole("button", { name: "Expand performance", exact: true })).toBeFocused();
      await expect(tree).not.toHaveAttribute("data-virtualized", "true");
      if (mobile) {
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("bottom-nav-trigger")).toBeFocused();
        await expect(page.getByTestId("bottom-nav-sheet").locator(".wiki-shell-tree-root")).toHaveCount(0);
      }
    });
  }
}
