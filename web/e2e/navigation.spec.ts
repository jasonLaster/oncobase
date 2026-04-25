import { test, expect } from "@playwright/test";

// Desktop sidebar locator
const sidebar = "aside.hidden.md\\:flex nav";

test.describe("Page viewing & sidebar navigation", () => {
  test("serves the about index canonical redirect before rendering", async ({ request }) => {
    const response = await request.get("/about/index?token=diana", {
      maxRedirects: 0,
    });

    expect([307, 308]).toContain(response.status());
    expect(response.headers().location).toMatch(/\/about\/Index\?token=diana$/);
  });

  test("home page loads with wiki content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("article").first()).toBeVisible();
    const nav = page.locator(sidebar);
    await expect(
      nav.getByRole("button", { name: /^(▼|▶) sources$/ })
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: /^(▼|▶) wiki$/ })
    ).toBeVisible();
  });

  test("navigate to a page via sidebar", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    // Click a top-level file link visible without expanding (e.g., "index" or "Journal")
    await nav.getByRole("link", { name: "Journal" }).click();
    await expect(page).toHaveURL(/\/about\/Journal/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("redirects mixed-case wiki paths to canonical casing", async ({ page }) => {
    await page.goto("/about/index");
    await expect(page).toHaveURL(/\/about\/Index$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("page shows tags and copy button", async ({ page }) => {
    await page.goto("/wiki/diagnostics/diagnosis");
    await expect(page.locator("h1").first()).toContainText("Diagnosis");
    await expect(page.getByRole("link", { name: "TNBC" }).first()).toBeVisible();
    await expect(
      page.locator('button[aria-label="Copy page as markdown"]').first()
    ).toBeVisible();
  });

  test("actions menu opens with theme and download", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[aria-label="Actions"]').click();
    await expect(page.getByRole("menuitem", { name: "Theme: System" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download wiki (full)" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download wiki (markdown)" })).toBeVisible();
  });

  test("command palette opens with Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Find files/ })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(
      page.locator('[role="dialog"] [role="combobox"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("outline palette jumps to a selected heading", async ({ page }) => {
    await page.goto("/table-examples");

    const headings = page.locator("article h2[id], article h3[id]");
    await expect(headings.first()).toBeVisible();
    const heading = headings.last();

    const id = await heading.getAttribute("id");
    const headingText = await heading.evaluate((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".heading-anchor").forEach((anchor) => anchor.remove());
      return (clone.textContent ?? "").replace(/(?:\s*#\s*)+$/, "").trim();
    });

    if (!id || !headingText) {
      throw new Error("Expected the first table example heading to have text and an id");
    }

    await expect.poll(async () => {
      return page.evaluate((targetId) => {
        const target = document.getElementById(targetId);
        if (!target) return false;
        return target.getBoundingClientRect().top > window.innerHeight;
      }, id);
    }, { timeout: 15_000 }).toBe(true);

    await page.keyboard.press("Meta+Shift+O");
    const input = page.getByPlaceholder("Search headings…");
    await expect(input).toBeVisible();
    const dialog = page.locator('[role="dialog"]').filter({ has: input });

    await input.fill(headingText);
    const targetItem = dialog.locator("[cmdk-item]").filter({ hasText: headingText }).first();
    await expect(targetItem).toHaveAttribute("aria-selected", "true");

    await input.press("Enter");

    await expect.poll(async () => {
      return page.evaluate((targetId) => {
        const target = document.getElementById(targetId);
        if (!target) return false;
        return (
          target.getBoundingClientRect().top < 220 &&
          target.getBoundingClientRect().bottom > 0
        );
      }, id);
    }, { timeout: 15_000 }).toBe(true);
  });
});
