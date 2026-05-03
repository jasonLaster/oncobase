import { expect, test, type Page } from "@playwright/test";

const HASHED_WEEK_5_URL =
  "/wiki/updates/week-5-april-12-to-18#-therapeutics--still-evolving";
const WEEK_5_TARGET = "-therapeutics--still-evolving";
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

function previewBypassHeaders(): Record<string, string> {
  if (!previewBypassSecret) {
    return {};
  }

  return { "x-vercel-protection-bypass": previewBypassSecret };
}

async function getHashTargetState(page: Page, targetId = WEEK_5_TARGET) {
  return page.evaluate((id) => {
    const target = document.getElementById(id);
    const scrollContainer = target
      ? (() => {
          let current = target.parentElement;
          while (current) {
            const style = window.getComputedStyle(current);
            if (
              (style.overflowY === "auto" || style.overflowY === "scroll") &&
              current.scrollHeight > current.clientHeight
            ) {
              return current;
            }
            current = current.parentElement;
          }
          return document.scrollingElement;
        })()
      : null;

    return {
      hash: window.location.hash,
      targetTop: target?.getBoundingClientRect().top ?? null,
      scrollTop: scrollContainer instanceof HTMLElement ? scrollContainer.scrollTop : 0,
    };
  }, targetId);
}

function isTransientNavigationError(error: unknown) {
  return (
    error instanceof Error &&
    /Execution context was destroyed|Cannot find context with specified id|Frame was detached|Element is not attached/i.test(
      error.message
    )
  );
}

async function clickHeadingUntilHash(page: Page, selector: string, expectedHash: string) {
  const heading = page.locator(selector).filter({ visible: true }).first();
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await expect(heading).toHaveClass(/cursor-pointer/, { timeout: 15_000 });
  await heading.click();

  await expect
    .poll(
      async () => new URL(page.url()).hash,
      { timeout: 15_000 }
    )
    .toBe(expectedHash);
}

test.describe("Markdown heading anchors", () => {
  // Click-to-update-hash also runs on prod now; the rest of the suite
  // already does, and the prod render path emits the same anchor ids.
  test("clicking a markdown heading updates the URL hash", async ({ page }) => {
    await page.goto("/wiki/updates/week-5-april-12-to-18");

    const heading = page.locator(".prose h2[id]").first();
    await expect(heading).toBeVisible();

    const id = await heading.getAttribute("id");
    if (!id) {
      throw new Error("Expected markdown heading to have an id attribute");
    }

    await heading.click();

    await expect(page).toHaveURL(new RegExp(`#${id}$`), { timeout: 15_000 });
  });

  test("clicking a heading permalink copies the section URL", async ({ page, baseURL }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: baseURL ?? "http://localhost:3000",
    });
    await page.goto("/wiki/updates/week-5-april-12-to-18");

    const heading = page.locator(".prose h2[id]").first();
    await expect(heading).toBeVisible();
    const id = await heading.getAttribute("id");
    if (!id) {
      throw new Error("Expected markdown heading to have an id attribute");
    }

    await heading.locator(".heading-anchor").click({ force: true });

    await expect(page).toHaveURL(new RegExp(`#${id}$`), { timeout: 15_000 });
    await expect(page.getByText("Link copied")).toBeVisible();

    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedText).toBe(`${baseURL ?? "http://localhost:3000"}/wiki/updates/week-5-april-12-to-18#${id}`);
  });

  test("deep links scroll to the target heading for authenticated sessions", async ({ page }) => {
    await page.goto(HASHED_WEEK_5_URL);

    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);
  });

  test("same-page table-of-contents links scroll inside the article pane", async ({ page }) => {
    await page.goto("/wiki/updates/week-5-april-12-to-18");

    await page.locator(`.prose a[href="#${WEEK_5_TARGET}"]`).first().click();

    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);
  });

  test("cross-page markdown hash links use app navigation and scroll the article pane", async ({ page }) => {
    await page.goto("/wiki/updates/week-5-april-12-to-18");

    await page.locator('.prose a[href="/about/Terminology#brca"]').first().click();

    await expect(page).toHaveURL(/\/about\/Terminology#brca$/, { timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded");

    await expect.poll(async () => isHashTargetScrolled(page, "brca"), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page, "brca");
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);
  });

  test("cross-page markdown links without hashes reset the article scroll after app navigation", async ({ page }) => {
    await page.goto(HASHED_WEEK_5_URL);
    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    await page
      .locator('.prose a[href="/wiki/treatment/therapeutics/radioligand-therapy"]')
      .first()
      .click();

    await expect(page).toHaveURL(/\/wiki\/treatment\/therapeutics\/radioligand-therapy$/, {
      timeout: 15_000,
    });
    await page.waitForLoadState("domcontentloaded");

    await expect.poll(async () => getArticleScrollTop(page), { timeout: 15_000 }).toBeLessThan(80);
  });

  test("login redirects preserve the original URL hash", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await page.goto(`${baseURL}${HASHED_WEEK_5_URL}`);
    await page.getByPlaceholder("Password").fill("diana");
    await page.getByRole("button", { name: "Enter" }).click();

    await expect(page).toHaveURL(new RegExp(`${WEEK_5_TARGET}$`), { timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded");
    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);

    await context.close();
  });

  test("command palette navigation wires anchors on the destination page", async ({ page }) => {
    await page.goto("/about/About");

    await expect(page.locator("article h1").first()).toHaveText("About This Wiki");

    await page.getByRole("button", { name: /Find files/ }).click();
    const input = page.getByPlaceholder("Search pages");
    await expect(input).toBeEditable({ timeout: 15_000 });
    await input.fill("about terminology", { force: true });
    await expect(page.locator('[cmdk-item][data-value="about/Terminology"]')).toBeVisible({
      timeout: 30_000,
    });

    await Promise.all([
      page.waitForURL(/\/about\/Terminology$/),
      input.press("Enter"),
    ]);

    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("article h1").first()).toHaveText("Terminology");

    await clickHeadingUntilHash(
      page,
      "article .prose h2#survival-endpoints",
      "#survival-endpoints"
    );
    await expect(page).toHaveURL(/\/about\/Terminology#survival-endpoints$/);
  });
});

async function isHashTargetScrolled(page: Page, targetId = WEEK_5_TARGET) {
  let state;
  try {
    state = await getHashTargetState(page, targetId);
  } catch (error) {
    if (isTransientNavigationError(error)) {
      return false;
    }
    throw error;
  }

  return (
    state.hash === `#${targetId}` &&
    state.scrollTop > 1000 &&
    state.targetTop !== null &&
    state.targetTop < 140
  );
}

async function getArticleScrollTop(page: Page) {
  return page.evaluate(() => {
    const article = document.querySelector("article");
    if (!article) return 0;

    let current = article.parentElement;
    while (current) {
      const style = window.getComputedStyle(current);
      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        return current.scrollTop;
      }
      current = current.parentElement;
    }

    return document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement.scrollTop
      : 0;
  });
}
