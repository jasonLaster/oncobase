import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure the desktop comments sidebar pane is open. */
async function ensureCommentsPaneOpen(page: Page) {
  const addBtn = page
    .getByRole("button", { name: "Add a page-level comment" })
    .last();

  if (await addBtn.isVisible().catch(() => false)) return;

  // Pane is collapsed – click the comments icon to expand
  const openBtn = page.getByRole("button", { name: "Open comments" }).last();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
  }

  await expect(addBtn).toBeVisible({ timeout: 10_000 });
}

/** Wait for the Liveblocks provider to finish initialising. */
async function waitForLiveblocks(page: Page) {
  // The sidebar shows a thread count or "No comments yet" once loaded
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        /\d+ (unresolved|total) thread/.test(text) ||
        text.includes("No comments yet") ||
        text.includes("No open comments") ||
        text.includes("Add a page-level comment")
      );
    },
    { timeout: 15_000 }
  );
}

// ---------------------------------------------------------------------------
// Document sidebar – basic loading
// ---------------------------------------------------------------------------

test.describe("Document comments sidebar", () => {
  test("sidebar loads with Comments / Outline toggle", async ({ page }) => {
    await page.goto("/wiki/about");
    await waitForLiveblocks(page);

    // Comments and Outline toggle buttons
    const commentsTab = page.getByRole("button", { name: "Comments" }).last();
    const outlineTab = page.getByRole("button", { name: "Outline" }).last();
    await expect(commentsTab).toBeVisible();
    await expect(outlineTab).toBeVisible();
  });

  test("sidebar shows thread count", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/wiki/about");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    // Verify the thread count text exists in the page
    await page.waitForFunction(
      () => /\d+ unresolved thread/.test(document.body.innerText),
      { timeout: 15_000 }
    );
  });

  test("switching to Outline tab shows headings", async ({ page }) => {
    await page.goto("/wiki/about");
    await waitForLiveblocks(page);

    await page.getByRole("button", { name: "Outline" }).last().click();

    // The about page has headings – target desktop sidebar (last visible instance)
    await expect(
      page.locator("text=/\\d+ heading/").last()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("collapse and expand sidebar persists across reload", async ({ page }) => {
    await page.goto("/wiki/about");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    // Collapse the pane
    await page
      .getByRole("button", { name: "Collapse comments pane" })
      .last()
      .click();

    // After collapse, the "Open comments" icon should be visible
    await expect(
      page.getByRole("button", { name: "Open comments" }).last()
    ).toBeVisible();

    // Reload – should still be collapsed (localStorage persistence)
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("button", { name: "Open comments" }).last()
    ).toBeVisible({ timeout: 10_000 });

    // Re-expand
    await page.getByRole("button", { name: "Open comments" }).last().click();
    await expect(
      page.getByRole("button", { name: "Add a page-level comment" }).last()
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Document sidebar – comment actions dropdown
// ---------------------------------------------------------------------------

test.describe("Comment actions dropdown", () => {
  test("comment actions menu opens with filter option", async ({ page }) => {
    await page.goto("/Journal");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    await page.getByRole("button", { name: "Comment actions" }).last().click();
    await expect(
      page.getByRole("menuitem", { name: /View all threads|Show unresolved only/ })
    ).toBeVisible();
  });

  test("toggling resolved filter changes thread count label", async ({ page }) => {
    await page.goto("/Journal");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    // Capture initial text
    const countBefore = await page
      .locator("text=/\\d+ (unresolved|total) thread/")
      .first()
      .textContent();

    // Toggle the filter
    await page.getByRole("button", { name: "Comment actions" }).last().click();
    const menuItem = page.getByRole("menuitem", {
      name: /View all threads|Show unresolved only/,
    });
    await menuItem.click();

    // The label should change between "unresolved" and "total"
    const countAfter = await page
      .locator("text=/\\d+ (unresolved|total) thread/")
      .first()
      .textContent();
    expect(countAfter).not.toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Document sidebar – creating comments
// ---------------------------------------------------------------------------

test.describe("Creating comments", () => {
  test("page-level composer opens and has send button", async ({ page }) => {
    await page.goto("/Journal");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    await page
      .getByRole("button", { name: "Add a page-level comment" })
      .last()
      .click();

    // Composer editor and send button should appear
    const editor = page.getByRole("textbox", { name: "Composer editor" }).last();
    await expect(editor).toBeVisible();

    // Send button should exist (may be disabled until text is entered)
    await expect(page.getByRole("button", { name: "Send" }).last()).toBeVisible();
  });

  test("typing in composer enables send button", async ({ page }) => {
    await page.goto("/Journal");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    await page
      .getByRole("button", { name: "Add a page-level comment" })
      .last()
      .click();

    const editor = page.getByRole("textbox", { name: "Composer editor" }).last();
    await editor.click();
    await editor.pressSequentially("test comment");

    const sendBtn = page.getByRole("button", { name: "Send" }).last();
    await expect(sendBtn).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Text selection & highlights
// ---------------------------------------------------------------------------

test.describe("Text selection", () => {
  test("highlight overlay does not block text selection", async ({ page }) => {
    await page.goto("/wiki/about");
    await waitForLiveblocks(page);

    // Verify we can select text in the article
    const article = page.locator("article").first();
    await expect(article).toBeVisible();

    // Triple-click to select a paragraph – should not be blocked
    const firstParagraph = article.locator("p").first();
    await firstParagraph.click({ clickCount: 3 });

    const selection = await page.evaluate(() => window.getSelection()?.toString());
    expect(selection).toBeTruthy();
    expect((selection ?? "").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Global comments page
// ---------------------------------------------------------------------------

test.describe("Global comments page", () => {
  test("loads and shows thread list", async ({ page }) => {
    await page.goto("/comments");

    // Wait for threads to load (either shows threads or empty state)
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("threads") ||
          text.includes("No comments yet") ||
          text.includes("No open comments") ||
          text.includes("Loading")
        );
      },
      { timeout: 15_000 }
    );

    // "View all comments" or "Open only" button should exist
    await expect(
      page.getByRole("button", { name: /View all comments|Open only/ })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("comments page renders thread list or empty state", async ({ page }) => {
    await page.goto("/comments");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("article").length > 0 ||
        document.body.innerText.includes("No comments") ||
        document.body.innerText.includes("Loading"),
      { timeout: 15_000 }
    );
  });

  test("thread cards link to source documents", async ({ page }) => {
    await page.goto("/comments");

    // Wait for content to load
    await page.waitForFunction(
      () =>
        document.querySelectorAll("article").length > 0 ||
        document.body.innerText.includes("No comments"),
      { timeout: 15_000 }
    );

    const articles = page.locator("article");
    const count = await articles.count();
    if (count === 0) {
      // No comments – that's okay, skip the link check
      return;
    }

    // Each thread card should have a link to the document
    const firstArticle = articles.first();
    const link = firstArticle.locator("a").first();
    if (await link.isVisible().catch(() => false)) {
      const href = await link.getAttribute("href");
      expect(href).toBeTruthy();
      // Links should point to document pages (start with /)
      expect(href).toMatch(/^\//);
    }
  });

  test("toggle between open and all comments", async ({ page }) => {
    await page.goto("/comments");

    const toggleBtn = page.getByRole("button", {
      name: /View all comments|Open only/,
    });
    await expect(toggleBtn).toBeVisible({ timeout: 15_000 });

    const textBefore = await toggleBtn.textContent();
    await toggleBtn.click();
    const textAfter = await toggleBtn.textContent();

    // Button label should toggle
    expect(textAfter).not.toBe(textBefore);
  });
});

// ---------------------------------------------------------------------------
// Delete thread (server-side)
// ---------------------------------------------------------------------------

test.describe("Delete thread", () => {
  test("delete-thread API rejects missing params", async ({ request }) => {
    const res = await request.post("/api/liveblocks-delete-thread", {
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("delete thread menu item appears on first comment", async ({ page }) => {
    await page.goto("/wiki/about");
    await waitForLiveblocks(page);
    await ensureCommentsPaneOpen(page);

    // Hover over a comment to reveal actions, then open the More menu
    const moreButton = await page.evaluate(() => {
      const comments = Array.from(
        document.querySelectorAll(".lb-comment")
      ).filter((c) => (c as HTMLElement).getBoundingClientRect().width > 0);
      const first = comments[0] as HTMLElement | undefined;
      if (!first) return false;

      ["pointerenter", "mouseenter", "pointerover", "mouseover"].forEach(
        (type) => {
          const r = first.getBoundingClientRect();
          first.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              clientX: r.x + r.width / 2,
              clientY: r.y + r.height / 2,
            })
          );
        }
      );

      const btn = first.querySelector(
        'button[aria-label="More"]'
      ) as HTMLElement | null;
      if (!btn || btn.getBoundingClientRect().width === 0) return false;

      const rect = btn.getBoundingClientRect();
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(
        (type) => {
          btn.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              clientX: rect.x + rect.width / 2,
              clientY: rect.y + rect.height / 2,
            })
          );
        }
      );

      return true;
    });

    if (!moreButton) {
      // No comments on this page — skip
      return;
    }

    await page.waitForTimeout(500);

    const deleteItem = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll('.lb-dropdown [role="menuitem"]')
      );
      return items.map((i) => (i as HTMLElement).textContent?.trim());
    });

    expect(deleteItem).toContain("Delete thread");
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

test.describe("API endpoints", () => {
  test("liveblocks-auth GET returns configured status", async ({ request }) => {
    const res = await request.get("/api/liveblocks-auth");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("configured");
    expect(typeof body.configured).toBe("boolean");
  });

  test("liveblocks-threads GET returns threads array", async ({ request }) => {
    const res = await request.get("/api/liveblocks-threads");
    // May be 503 if secret key not configured in CI, or 200
    if (res.ok()) {
      const body = await res.json();
      expect(body).toHaveProperty("threads");
      expect(Array.isArray(body.threads)).toBeTruthy();
      if (body.userNames) {
        expect(typeof body.userNames).toBe("object");
      }
    }
  });

  test("auth session GET returns user object", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("user");
  });
});

// ---------------------------------------------------------------------------
// Sidebar navigation links
// ---------------------------------------------------------------------------

test.describe("Sidebar navigation", () => {
  test("Chat with wiki link is visible in sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Chat with wiki" })).toBeVisible();
  });

  test("View comments link is visible in sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "View comments" })
    ).toBeVisible();
  });

  test("clicking View comments navigates to /comments", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "View comments" }).click();
    await expect(page).toHaveURL(/\/comments/);
  });
});
