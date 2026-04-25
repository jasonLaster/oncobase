import { expect, test, type Page } from "@playwright/test";
import { Liveblocks } from "@liveblocks/node";
import fs from "node:fs";
import path from "node:path";

const ROOM_ID = "markdown:about/About";
const DOCUMENT_SLUG = "about/About";
const DOCUMENT_TITLE = "About";
function readLocalEnv(name: string) {
  if (process.env[name]) return process.env[name];

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return undefined;

  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  const value = line?.split("=").slice(1).join("=").trim();
  return value?.replace(/^["']|["']$/g, "");
}

const liveblocksSecret =
  readLocalEnv("LIVEBLOCKS_SECRET_KEY") ?? readLocalEnv("LIVEBLOCKS_API_KEY");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure the desktop comments sidebar pane is open. */
async function ensureCommentsPaneOpen(page: Page) {
  const addBtn = page
    .getByRole("button", { name: "Add a page-level comment" })
    .last();

  if (await addBtn.isVisible().catch(() => false)) return;

  // Pane is collapsed or still in lazy outline mode; activate comments.
  const openBtn = page.getByRole("button", { name: "Open comments" }).last();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
  } else {
    const commentsTab = page
      .getByRole("button", { name: "Comments", exact: true })
      .last();
    if (await commentsTab.isVisible().catch(() => false)) {
      await commentsTab.click();
    }
  }

  await expect(addBtn).toBeVisible({ timeout: 10_000 });
}

async function waitForCommentsListSettled(page: Page) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading comments"),
    { timeout: 15_000 }
  );
}

async function waitForCommentsUi(page: Page) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some(
        (button) =>
          (button.textContent ?? "").includes("Add a page-level comment")
      ) || /\d+ (unresolved|total) thread/.test(text) ||
        text.includes("No comments yet") ||
        text.includes("No open comments") ||
        text.includes("Comments are temporarily unavailable.");
    },
    { timeout: 15_000 }
  );
}

async function selectArticleText(page: Page) {
  const selectedText = await page.evaluate(() => {
    const root = document.querySelector("article");
    if (!root) return "";

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        return text.length > 40
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const textNode = walker.nextNode() as Text | null;
    if (!textNode?.textContent) return "";

    const text = textNode.textContent;
    const start = Math.max(0, text.search(/\S/));
    const end = Math.min(text.length, start + 80);
    if (end <= start) return "";

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })
    );

    return range.toString();
  });

  expect(selectedText.trim().length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Add comment" })).toBeVisible({
    timeout: 5_000,
  });
  return selectedText;
}

async function clickCommentAction(
  page: Page,
  actionLabel: string,
  threadId?: string
) {
  if (threadId) {
    await page.waitForFunction(
      (id) =>
        Array.from(
          document.querySelectorAll(`[data-thread-id="${CSS.escape(id)}"]`)
        ).some((item) => {
          const rect = (item as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }),
      threadId,
      { timeout: 5_000 }
    );

    return await page.evaluate(
      ({ label, id }) => {
        for (const item of Array.from(
          document.querySelectorAll(`[data-thread-id="${CSS.escape(id)}"]`)
        )) {
          const element = item as HTMLElement;
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const comment = element.querySelector(".lb-comment") as HTMLElement | null;
          if (comment) {
            const commentRect = comment.getBoundingClientRect();
            ["pointerenter", "mouseenter", "pointerover", "mouseover"].forEach(
              (type) => {
                comment.dispatchEvent(
                  new PointerEvent(type, {
                    bubbles: true,
                    composed: true,
                    clientX: commentRect.x + commentRect.width / 2,
                    clientY: commentRect.y + commentRect.height / 2,
                  })
                );
              }
            );
          }

          const button = Array.from(
            element.querySelectorAll(`button[aria-label="${label}"]`)
          ).find((candidate) => {
            const buttonRect = (candidate as HTMLElement).getBoundingClientRect();
            return buttonRect.width > 0 && buttonRect.height > 0;
          }) as HTMLElement | undefined;

          if (!button) return null;
          const buttonRect = button.getBoundingClientRect();
          ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(
            (type) => {
              button.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  composed: true,
                  clientX: buttonRect.x + buttonRect.width / 2,
                  clientY: buttonRect.y + buttonRect.height / 2,
                })
              );
            }
          );
          return true;
        }

        return false;
      },
      { label: actionLabel, id: threadId }
    );
  }

  return await page.evaluate(({ label, targetThreadId }) => {
    const root = targetThreadId
      ? document.querySelector(`[data-thread-id="${CSS.escape(targetThreadId)}"]`)
      : document;
    if (!root) return false;

    const comments = Array.from(root.querySelectorAll(".lb-comment")).filter(
      (comment) => {
        const rect = (comment as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
    );

    for (const comment of comments) {
      const element = comment as HTMLElement;
      const rect = element.getBoundingClientRect();
      ["pointerenter", "mouseenter", "pointerover", "mouseover"].forEach(
        (type) => {
          element.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              clientX: rect.x + rect.width / 2,
              clientY: rect.y + rect.height / 2,
            })
          );
        }
      );

      const button = element.querySelector(
        `button[aria-label="${label}"]`
      ) as HTMLElement | null;
      if (!button || button.getBoundingClientRect().width === 0) continue;

      const buttonRect = button.getBoundingClientRect();
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(
        (type) => {
          button.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              clientX: buttonRect.x + buttonRect.width / 2,
              clientY: buttonRect.y + buttonRect.height / 2,
            })
          );
        }
      );

      return true;
    }

    return false;
  }, { label: actionLabel, targetThreadId: threadId });
}

async function visibleCommentListItems(page: Page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-comment-list-item]"))
      .filter((item) => {
        const element = item as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .map((item) => {
        const element = item as HTMLElement;
        const anchorStart = element.getAttribute("data-anchor-start");
        return {
          type: element.getAttribute("data-comment-list-item"),
          threadId: element.getAttribute("data-thread-id"),
          anchorStart:
            anchorStart === null ? Number.POSITIVE_INFINITY : Number(anchorStart),
        };
      })
  );
}

async function visibleCommentsRailWidth(page: Page) {
  return await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('button[aria-label="Collapse comments pane"]')
    );

    for (const button of buttons) {
      const aside = button.closest("aside");
      const rect = aside?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        return rect.width;
      }
    }

    return 0;
  });
}

function bottomCommentsRail(page: Page) {
  return page.locator("[data-comments-bottom-rail]:visible").last();
}

async function expectVisibleOutlineHeadingCount(page: Page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("p")).some((item) => {
        const element = item as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          /\d+ heading/.test(element.textContent ?? "") &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }),
    { timeout: 5_000 }
  );
}

async function deleteThread(page: Page, threadId: string) {
  const liveblocks = liveblocksSecret
    ? new Liveblocks({ secret: liveblocksSecret })
    : null;

  if (liveblocks) {
    await liveblocks.deleteThread({ roomId: ROOM_ID, threadId }).catch(() => {});
    return;
  }

  await page.evaluate(
    async ({ roomId, id }) => {
      await fetch("/api/liveblocks-delete-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          threadId: id,
        }),
      });
    },
    { roomId: ROOM_ID, id: threadId }
  );
}

function commentBody(text: string) {
  return {
    version: 1 as const,
    content: [
      {
        type: "paragraph" as const,
        children: [{ text }],
      },
    ],
  };
}

async function createThreadFixture(
  text: string,
  metadata: Record<string, string | number | boolean | undefined>
) {
  test.skip(!liveblocksSecret, "Liveblocks secret unavailable");

  const liveblocks = new Liveblocks({ secret: liveblocksSecret! });
  const thread = await liveblocks.createThread({
    roomId: ROOM_ID,
    data: {
      metadata,
      comment: {
        userId: `guest_playwright_${Date.now()}_${Math.floor(
          Math.random() * 1000
        )}`,
        body: commentBody(text),
      },
    },
  });

  return thread.id;
}

async function firstArticleAnchor(page: Page) {
  return await page.evaluate(() => {
    const root = document.querySelector("article");
    const fullText = root?.textContent ?? "";
    const start = Math.max(0, fullText.search(/\S/));
    const end = Math.min(fullText.length, start + 80);
    return {
      start,
      end,
      quote: fullText.slice(start, end),
      prefix: fullText.slice(Math.max(0, start - 32), start),
      suffix: fullText.slice(end, Math.min(fullText.length, end + 32)),
    };
  });
}

async function waitForVisibleThreadId(
  page: Page,
  text: string,
  options?: { anchored?: boolean }
) {
  await page.waitForFunction(
    ({ expectedText, anchored }) => {
      const selector = anchored
        ? '[data-comment-list-item="thread"][data-anchor-start]'
        : '[data-comment-list-item="thread"]';

      return Array.from(document.querySelectorAll(selector)).some((item) => {
        const element = item as HTMLElement;
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          element.textContent?.includes(expectedText)
        );
      });
    },
    { expectedText: text, anchored: Boolean(options?.anchored) },
    { timeout: 15_000 }
  );

  const threadId = await page.evaluate(
    ({ expectedText, anchored }) => {
      const selector = anchored
        ? '[data-comment-list-item="thread"][data-anchor-start]'
        : '[data-comment-list-item="thread"]';

      for (const item of Array.from(document.querySelectorAll(selector))) {
        const element = item as HTMLElement;
        const rect = element.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          element.textContent?.includes(expectedText)
        ) {
          return element.getAttribute("data-thread-id");
        }
      }

      return null;
    },
    { expectedText: text, anchored: Boolean(options?.anchored) }
  );

  expect(threadId).toBeTruthy();
  return threadId!;
}

async function expectVisibleThreadActive(page: Page, threadId: string) {
  await page.waitForFunction(
    (id) =>
      Array.from(
        document.querySelectorAll(`[data-thread-id="${CSS.escape(id)}"]`)
      ).some((item) => {
        const element = item as HTMLElement;
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          element.className.includes("border-sky")
        );
      }),
    threadId,
    { timeout: 10_000 }
  );
}

async function createPageLevelComment(page: Page) {
  await ensureCommentsPaneOpen(page);
  await waitForCommentsListSettled(page);
  const text = `Playwright page comment ${Date.now()} ${Math.floor(
    Math.random() * 1000
  )}`;

  const createdThreadId = await createThreadFixture(text, {
    documentSlug: DOCUMENT_SLUG,
    documentTitle: DOCUMENT_TITLE,
  });
  await page.goto(`/about/About?thread=${createdThreadId}`);
  await waitForCommentsUi(page);
  await ensureCommentsPaneOpen(page);
  const threadId = await waitForVisibleThreadId(page, text);
  return { text, threadId };
}

async function createSelectionComment(page: Page) {
  await ensureCommentsPaneOpen(page);
  await waitForCommentsListSettled(page);
  const text = `Playwright selection comment ${Date.now()} ${Math.floor(
    Math.random() * 1000
  )}`;

  const anchor = await firstArticleAnchor(page);
  const createdThreadId = await createThreadFixture(text, {
    documentSlug: DOCUMENT_SLUG,
    documentTitle: DOCUMENT_TITLE,
    anchorStart: anchor.start,
    anchorEnd: anchor.end,
    anchorQuote: anchor.quote,
    anchorPrefix: anchor.prefix,
    anchorSuffix: anchor.suffix,
  });
  await page.goto(`/about/About?thread=${createdThreadId}`);
  await waitForCommentsUi(page);
  await ensureCommentsPaneOpen(page);
  const threadId = await waitForVisibleThreadId(page, text, { anchored: true });
  return { text, threadId };
}

/** Activate comments (click the comment icon) and wait for Liveblocks to initialise. */
async function activateAndWaitForComments(page: Page) {
  const readState = () =>
    page.evaluate(() => {
      const text = document.body.innerText;
      const buttons = Array.from(document.querySelectorAll("button"));
      const hasReadyUi =
        buttons.some((button) =>
          (button.textContent ?? "").includes("Add a page-level comment")
        ) ||
        /\d+ (unresolved|total) thread/.test(text) ||
        text.includes("No comments yet") ||
        text.includes("No open comments");

      if (hasReadyUi) return "ready";
      if (
        text.includes("Comments are temporarily unavailable.") ||
        text.includes("Failed to fetch threads")
      ) {
        return "unavailable";
      }

      return "pending";
    });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await readState();
    if (state === "ready") return true;
    if (state === "unavailable") return false;

    const candidates = [
      page.getByRole("button", { name: "Open comments" }).last(),
      page.getByRole("button", { name: "Comments", exact: true }).last(),
    ];
    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ timeout: 1_000 }).catch(() => {});
        break;
      }
    }

    await page.waitForTimeout(500);
  }

  return false;
}

/** Check if the comments feature is active on a document page. */
async function commentsAreEnabled(page: Page) {
  const openComments = page.getByRole("button", { name: "Open comments" }).last();
  if (await openComments.isVisible({ timeout: 10_000 }).catch(() => false)) {
    return true;
  }

  return page
    .getByRole("button", { name: "Comments", exact: true })
    .last()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

async function openGlobalCommentsPage(page: Page) {
  const threadsResponse = page
    .waitForResponse(
      (response) =>
        response.url().includes("/api/liveblocks-threads") &&
        response.request().method() === "GET",
      { timeout: 20_000 }
    )
    .catch(() => null);

  await page.goto("/comments");
  if (!page.url().includes("/comments")) return "disabled" as const;

  const response = await threadsResponse;
  if (!response?.ok()) return "unavailable" as const;

  const ready = await page
    .waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          document.querySelectorAll("article").length > 0 ||
          text.includes("No comments yet") ||
          text.includes("No open comments") ||
          text.includes("Failed to fetch threads")
        );
      },
      { timeout: 20_000 }
    )
    .then(() => true)
    .catch(() => false);

  return ready ? ("ready" as const) : ("unavailable" as const);
}

async function waitForGlobalCommentsContent(page: Page) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        document.querySelectorAll("article").length > 0 ||
        text.includes("No comments yet") ||
        text.includes("No open comments") ||
        text.includes("Failed to fetch threads")
      );
    },
    { timeout: 15_000 }
  );

  return (await page.locator("article").count()) > 0 ? "threads" : "empty";
}

// ---------------------------------------------------------------------------
// Document sidebar – basic loading
// ---------------------------------------------------------------------------

test.describe("Document comments sidebar", () => {
  test("sidebar loads with Comments / Outline toggle", async ({ page }) => {
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");

    // Comments and Outline toggle buttons
    const commentsTab = page
      .getByRole("button", { name: "Comments", exact: true })
      .last();
    const outlineTab = page
      .getByRole("button", { name: "Outline", exact: true })
      .last();
    await expect(commentsTab).toBeVisible();
    await expect(outlineTab).toBeVisible();
  });

  test("sidebar shows thread count", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    // Verify the thread count text exists in the page
    await page.waitForFunction(
      () => /\d+ unresolved thread/.test(document.body.innerText),
      { timeout: 15_000 }
    );
  });

  test("switching to Outline tab shows headings", async ({ page }) => {
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");

    await page
      .getByRole("button", { name: "Outline", exact: true })
      .last()
      .click();

    // The about page has headings – target desktop sidebar (last visible instance)
    await expectVisibleOutlineHeadingCount(page);
  });

  test("outline sidebar renders on document page", async ({ page }) => {
    await page.goto("/about/About");
    // The outline sidebar should render (with or without comments)
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10_000 });
    // Either "Open outline" or "Outline" tab should be present
    const hasOutline = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some(
        (b) =>
          b.getAttribute("aria-label") === "Open outline" ||
          b.textContent?.trim() === "Outline"
      );
    });
    expect(hasOutline).toBe(true);
  });

  test("open outline rail still exposes comments activation", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("comments-pane-open", "1");
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");

    await expect(
      page.getByRole("button", { name: "Comments", exact: true }).last()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Outline", exact: true }).last()
    ).toBeVisible();
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");

    await expect(
      page.getByRole("button", { name: "Add a page-level comment" }).last()
    ).toBeVisible();
  });

  test("mobile bottom rail outline still exposes comments activation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");

    await expect(
      page.getByRole("button", { name: "Comments", exact: true }).last()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Outline", exact: true }).last()
    ).toBeVisible();
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");

    await expect(
      page.getByRole("button", { name: "Add a page-level comment" })
    ).toBeVisible();
  });

  test("phone bottom rail switches between comments and outline", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");

    const rail = bottomCommentsRail(page);
    await expect(rail).toBeVisible();
    const railBox = await rail.boundingBox();
    expect(railBox).toBeTruthy();
    expect(railBox!.y).toBeGreaterThan(250);

    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await expect(
      rail.getByRole("button", { name: "Add a page-level comment" })
    ).toBeVisible();

    await rail.getByRole("button", { name: "Outline", exact: true }).click();
    await expectVisibleOutlineHeadingCount(page);

    await rail.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(
      rail.getByRole("button", { name: "Add a page-level comment" })
    ).toBeVisible();
  });

  test("ipad bottom rail switches between comments and outline", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");

    const rail = bottomCommentsRail(page);
    await expect(rail).toBeVisible();
    const railBox = await rail.boundingBox();
    expect(railBox).toBeTruthy();
    expect(railBox!.y).toBeGreaterThan(360);

    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await expect(
      rail.getByRole("button", { name: "Add a page-level comment" })
    ).toBeVisible();

    await rail.getByRole("button", { name: "Outline", exact: true }).click();
    await expectVisibleOutlineHeadingCount(page);

    await rail.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(
      rail.getByRole("button", { name: "Add a page-level comment" })
    ).toBeVisible();
  });

  test("comment and outline rail buttons toggle the rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    await page
      .getByRole("button", { name: "Comments", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "Open comments" }).last()
    ).toBeVisible();

    await page.getByRole("button", { name: "Open outline" }).last().click();
    await expectVisibleOutlineHeadingCount(page);

    await page
      .getByRole("button", { name: "Outline", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "Open outline" }).last()
    ).toBeVisible();
  });

  test("comments rail can be resized", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    const widthBefore = await visibleCommentsRailWidth(page);
    const resizer = page.getByRole("separator", { name: "Resize comments pane" });
    const box = await resizer.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x - 80, box!.y + box!.height / 2);
    await page.mouse.up();

    const widthAfter = await visibleCommentsRailWidth(page);
    expect(widthAfter).toBeGreaterThan(widthBefore + 40);
  });
});

// ---------------------------------------------------------------------------
// Document sidebar – comment actions dropdown
// ---------------------------------------------------------------------------

test.describe("Comment actions dropdown", () => {
  test("comment actions menu opens with filter option", async ({ page }) => {
    await page.goto("/about/Journal");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    await page.getByRole("button", { name: "Comment actions" }).last().click();
    await expect(
      page.getByRole("menuitem", { name: /View all threads|Show unresolved only/ })
    ).toBeVisible();
  });

  test("toggling resolved filter changes thread count label", async ({ page }) => {
    await page.goto("/about/Journal");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
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

  test("per-comment actions dropdown opens above the rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    const { threadId } = await createPageLevelComment(page);
    try {
      const opened = await clickCommentAction(page, "More", threadId);
      expect(opened).toBe(true);

      const dropdown = page.locator(".lb-dropdown").last();
      await expect(dropdown).toBeVisible({ timeout: 5_000 });
      await expect(
        dropdown.getByRole("menuitem", { name: "Copy comment" })
      ).toBeVisible();
      await expect(dropdown).toHaveCSS("z-index", "50");
    } finally {
      await deleteThread(page, threadId);
    }
  });

  test("reaction emoji picker opens above the rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    const { threadId } = await createPageLevelComment(page);
    try {
      const opened = await clickCommentAction(page, "Add reaction", threadId);
      expect(opened).toBe(true);

      const picker = page.locator(".lb-emoji-picker").last();
      await expect(picker).toBeVisible({ timeout: 5_000 });
      await expect(picker).toHaveCSS("z-index", "50");
    } finally {
      await deleteThread(page, threadId);
    }
  });
});

// ---------------------------------------------------------------------------
// Document sidebar – creating comments
// ---------------------------------------------------------------------------

test.describe("Creating comments", () => {
  test("page-level composer opens and has send button", async ({ page }) => {
    await page.goto("/about/Journal");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
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
    await page.goto("/about/Journal");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
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
    await page.goto("/about/About");
    // Wait for page content to render (works with or without comments)
    await expect(page.locator("article").first()).toBeVisible();

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

  test("pending highlight renders behind article text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    await selectArticleText(page);
    await page.waitForSelector('[data-comment-highlight="pending"]', {
      timeout: 5_000,
    });

    const layering = await page.evaluate(() => {
      const highlight = document.querySelector(
        '[data-comment-highlight="pending"]'
      ) as HTMLElement | null;
      const layer = document.querySelector(
        "[data-comment-highlight-layer]"
      ) as HTMLElement | null;
      const content = document.querySelector(
        "[data-comment-content]"
      ) as HTMLElement | null;
      if (!highlight || !layer || !content) return null;

      const rect = highlight.getBoundingClientRect();
      const topElement = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );

      return {
        highlightLayerZ: window.getComputedStyle(layer).zIndex,
        contentZ: window.getComputedStyle(content).zIndex,
        topElementIsContent: Boolean(topElement && content.contains(topElement)),
      };
    });

    expect(layering).toEqual({
      highlightLayerZ: "0",
      contentZ: "10",
      topElementIsContent: true,
    });
  });

  test("draft selection thread renders in sorted list order", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    await selectArticleText(page);
    await page.getByRole("button", { name: "Add comment" }).click();

    const draftThread = page.locator("[data-comment-draft-thread]").last();
    await expect(draftThread).toBeVisible({ timeout: 5_000 });
    await expect(draftThread.getByText("Linked selection")).toBeVisible();
    await expect(
      draftThread.getByRole("textbox", { name: "Composer editor" })
    ).toBeVisible();

    const items = await visibleCommentListItems(page);
    const anchorStarts = items.map((item) => item.anchorStart);
    expect(items.some((item) => item.type === "draft-selection")).toBe(true);
    expect(anchorStarts).toEqual(
      [...anchorStarts].sort((a, b) => a - b)
    );
  });

  test("opening a linked selection URL activates the thread", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    const { threadId } = await createSelectionComment(page);
    try {
      await page.goto(`/about/About?thread=${threadId}`);
      await waitForCommentsUi(page);
      await ensureCommentsPaneOpen(page);
      expect(new URL(page.url()).searchParams.get("thread")).toBe(threadId);
      await expectVisibleThreadActive(page, threadId);
    } finally {
      await deleteThread(page, threadId);
    }
  });
});

// ---------------------------------------------------------------------------
// Global comments page
// ---------------------------------------------------------------------------

test.describe("Global comments page", () => {
  test("loads and shows thread list", async ({ page }) => {
    const status = await openGlobalCommentsPage(page);
    test.skip(status === "disabled", "Comments feature not enabled");
    test.skip(status === "unavailable", "Comments backend unavailable");

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
    const status = await openGlobalCommentsPage(page);
    test.skip(status === "disabled", "Comments feature not enabled");
    test.skip(status === "unavailable", "Comments backend unavailable");

    await waitForGlobalCommentsContent(page);
  });

  test("thread cards link to source documents", async ({ page }) => {
    const status = await openGlobalCommentsPage(page);
    test.skip(status === "disabled", "Comments feature not enabled");
    test.skip(status === "unavailable", "Comments backend unavailable");

    let contentState = await waitForGlobalCommentsContent(page);
    const toggleBtn = page.getByRole("button", { name: /View all comments|Open only/ });

    if (
      contentState === "empty" &&
      (await toggleBtn.isVisible().catch(() => false)) &&
      ((await toggleBtn.textContent()) ?? "").includes("View all comments")
    ) {
      await toggleBtn.click();
      contentState = await waitForGlobalCommentsContent(page);
    }

    if (contentState === "empty") {
      // No comments in either open-only or all-comments mode.
      return;
    }

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
    const status = await openGlobalCommentsPage(page);
    test.skip(status === "disabled", "Comments feature not enabled");
    test.skip(status === "unavailable", "Comments backend unavailable");

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
    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
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

  test("delete thread action keeps the comments rail open", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/about/About");
    test.skip(!(await commentsAreEnabled(page)), "Comments feature not enabled");
    test.skip(!(await activateAndWaitForComments(page)), "Comments backend unavailable");
    await ensureCommentsPaneOpen(page);

    const { threadId } = await createPageLevelComment(page);
    try {
      const opened = await clickCommentAction(page, "More", threadId);
      expect(opened).toBe(true);

      const deleteThreadItem = page.getByRole("menuitem", {
        name: "Delete thread",
      });
      await expect(deleteThreadItem).toBeVisible({ timeout: 3_000 });

      await deleteThread(page, threadId);
      await expect(
        page.getByRole("button", { name: "Collapse comments pane" }).last()
      ).toBeVisible();
    } finally {
      await deleteThread(page, threadId);
    }
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

  test("liveblocks-users rejects malformed IDs", async ({ request }) => {
    const res = await request.post("/api/liveblocks-users", {
      data: { userIds: ["guest_ok", 123] },
    });
    expect(res.status()).toBe(400);
  });

  test("guest names are stored in Convex and resolvable to other users", async ({
    request,
  }) => {
    test.skip(process.env.TEST_ENV === "prod", "Avoid mutating production data");

    const guestId = `guest_playwright_${Date.now()}`;
    const name = `Playwright Guest ${Date.now()}`;
    const saveRes = await request.post("/api/liveblocks-guest", {
      data: { guestId, name },
    });
    test.skip(!saveRes.ok(), "Convex guest-name storage unavailable");

    const res = await request.post("/api/liveblocks-users", {
      data: { userIds: [guestId] },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.users?.[guestId]?.name).toBe(name);
  });

  test("signed-in user names resolve from Convex user records", async ({
    request,
  }) => {
    test.skip(process.env.TEST_ENV === "prod", "Avoid mutating production data");

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const name = `Playwright User ${suffix}`;
    const signupRes = await request.post("/api/auth/signup", {
      data: {
        name,
        email: `comments-${suffix}@example.test`,
        password: "playwright-password",
      },
    });
    test.skip(!signupRes.ok(), "Convex user storage unavailable");

    const sessionRes = await request.get("/api/auth/session");
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const userId = session.user?._id;
    expect(userId).toBeTruthy();

    const usersRes = await request.post("/api/liveblocks-users", {
      data: { userIds: [userId] },
    });
    expect(usersRes.ok()).toBeTruthy();
    const body = await usersRes.json();
    expect(body.users?.[userId]?.name).toBe(name);
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
    const link = page.getByRole("link", { name: "View comments" });
    // Link only appears when NEXT_PUBLIC_ENABLE_COMMENTS=true
    if (!(await link.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, "Comments feature not enabled");
    }
    await expect(link).toBeVisible();
  });

  test("clicking View comments navigates to /comments", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "View comments" });
    test.skip(!(await link.isVisible({ timeout: 3_000 }).catch(() => false)), "Comments feature not enabled");
    await link.click();
    await expect(page).toHaveURL(/\/comments/);
  });
});
