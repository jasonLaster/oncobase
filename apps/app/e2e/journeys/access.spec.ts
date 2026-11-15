import { expect, test, type Page } from "@playwright/test";
import { article, CARE, passGate, READER, requireLocalStack } from "./helpers";

// Real backend, no route mocks: runs against `bun run local:stack`, which seeds
// a care-team user (sees `private/`) and a reader with no role.
const PRIVATE_PAGE = "/private/care-team-notes";
const PRIVATE_MARKER = "Next oncology visit";

requireLocalStack();

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/?reader-action=signin");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await dialog.getByLabel("Email", { exact: true }).fill(user.email);
  await dialog.getByLabel("Password", { exact: true }).fill(user.password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function signOut(page: Page) {
  // Sign-out wipes the reader's stores and then reloads; mark this document so
  // the wait below is for the reloaded one, not for the sign-in button that
  // appears as soon as the identity changes (before the wipe has finished).
  await page.evaluate(() => { (window as Window & { __beforeSignOut?: boolean }).__beforeSignOut = true; });
  await page.getByRole("button", { name: "Workspace menu" }).click();
  // Wait for the request: navigating first aborts it and leaves the session alive.
  const done = page.waitForResponse((r) => r.url().includes("/api/auth/signout"));
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  expect((await done).ok(), "sign-out request").toBeTruthy();
  // The app reloads itself after the wipe; let it settle before navigating.
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => !(window as Window & { __beforeSignOut?: boolean }).__beforeSignOut
        && sessionStorage.getItem("wiki-vite:sign-out-wipe") !== null);
    } catch { return false; } // The document is being replaced.
  }, { message: "reloaded after the sign-out wipe", timeout: 20_000 }).toBe(true);
  await expect(page.getByTestId("sidebar-sign-in").filter({ visible: true })).toBeVisible();
}

/** The HTTP cache's answer for `url`, or status 0 when it has none. */
async function cachedOnly(url: string) {
  try {
    const response = await fetch(url, { cache: "only-if-cached", mode: "same-origin", credentials: "same-origin" });
    return { status: response.status, body: await response.text() };
  } catch {
    return { status: 0, body: "" };
  }
}

/** Session reader stores left in OPFS. */
async function sessionStoreDirectories() {
  const root = await navigator.storage.getDirectory() as FileSystemDirectoryHandle & { keys: () => AsyncIterable<string> };
  const names: string[] = [];
  for await (const name of root.keys()) if (name.startsWith("livestore-wiki-vite-") && name.includes("-session-")) names.push(name);
  return names;
}

/** The reader's own "not available" state, so absence is never a blank page. */
const unavailable = (page: Page) => page.locator('[data-reader-unavailable="true"]').filter({ visible: true });

test.describe("account access (real backend)", () => {
  test.beforeEach(async ({ page }) => passGate(page));

  test("a signed-out reader gets a sign-in path, not the sensitive page", async ({ page }) => {
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(unavailable(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("a signed-in reader without a role still cannot read it", async ({ page }) => {
    await signIn(page, READER);
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(unavailable(page).getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("a care-team reader reads it, keeps it across reload, and loses it on sign-out", async ({ page }) => {
    await signIn(page, CARE);
    await page.goto(PRIVATE_PAGE);
    await expect(article(page)).toContainText(PRIVATE_MARKER);

    await page.reload();
    await expect(article(page)).toContainText(PRIVATE_MARKER);

    await signOut(page);
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("switching accounts never shows the previous account's private content", async ({ page }) => {
    await signIn(page, CARE);
    await page.goto(PRIVATE_PAGE);
    await expect(article(page)).toContainText(PRIVATE_MARKER);
    // The article paints from the document before the store opens; wait for the
    // store so there is a persisted session copy for sign-out to remove. (A store
    // still booting at sign-out is retried by the next public load's cleanup.)
    await expect(page.locator("[data-reader-store-ready]")).toHaveAttribute("data-reader-store-ready", "true");
    // P11: the care team's content-addressed URL for the page, now in this
    // browser's HTTP cache (only-if-cached answers without the network).
    const versionedUrl = await page.evaluate(async (slug) => {
      const manifest = await (await fetch("/api/wiki/manifest?scope=session", { credentials: "same-origin" })).json() as { pages: Array<{ slug: string; contentHash: string }> };
      const hash = manifest.pages.find(item => item.slug === slug)!.contentHash;
      const url = `/api/wiki/pages?scope=session&slugs=${encodeURIComponent(slug)}&v=${encodeURIComponent(hash)}`;
      await (await fetch(url, { credentials: "same-origin" })).text();
      return url;
    }, PRIVATE_PAGE.slice(1));
    const cachedForCare = await page.evaluate(cachedOnly, versionedUrl);
    expect(cachedForCare.status, "versioned page cached for the care team").toBe(200);
    expect(cachedForCare.body).toContain(PRIVATE_MARKER);

    await signOut(page);
    // The client wiped the signed-out session's reader store before reloading.
    const wipe = await page.evaluate(() => JSON.parse(sessionStorage.getItem("wiki-vite:sign-out-wipe") ?? "null"));
    expect(wipe?.target).toBe("site");
    // It reached the session store: removed it, or found it still locked while
    // this tab's store let go of its files...
    expect([...wipe!.retired, ...wipe!.failed].some((name: string) => name.includes("-session-"))).toBe(true);
    // ...in which case the reloaded public page's cleanup removes it. What must
    // hold is that no session copy survives the sign-out.
    await expect.poll(() => page.evaluate(sessionStoreDirectories), { timeout: 10_000 }).toEqual([]);

    await signIn(page, READER);
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
    // Not in the HTTP cache any more (Clear-Site-Data, and Vary: Cookie)...
    const cachedForReader = await page.evaluate(cachedOnly, versionedUrl);
    expect(cachedForReader.status, "versioned page still cached after switching accounts").toBe(0);
    // ...and the server validates v against the new reader's access.
    const served = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      return { version: response.headers.get("x-wiki-version"), cacheControl: response.headers.get("cache-control"), body: await response.text() };
    }, versionedUrl);
    expect(served.body).not.toContain(PRIVATE_MARKER);
    expect(served.version).toBe("mismatch");
    expect(served.cacheControl).toBe("private, no-store");
  });

  test("text search finds the private page for the care team and hides it from a reader without a role", async ({ page }) => {
    const search = async () => {
      await page.goto("/search?q=oncology+visit");
      await page.getByRole("button", { name: "Text Search" }).click();
      await expect(page.getByTestId("search-text-summary").or(page.getByTestId("search-text-empty"))).toBeVisible();
    };

    await signIn(page, CARE);
    await search();
    await expect(page.getByTestId("search-text-file").filter({ hasText: /care-team-notes/ })).toBeVisible();
    await signOut(page);

    await signIn(page, READER);
    await search();
    await expect(page.getByText(/care-team-notes/)).toHaveCount(0);
  });
});
