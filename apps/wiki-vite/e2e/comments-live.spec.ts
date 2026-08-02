import { createRequire } from "node:module";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { documentArticle } from "./fixtures";
import { ensurePasswordGateSession } from "./gate-auth";

const { api } = createRequire(import.meta.url)(
  "../../web/convex/_generated/api.js",
) as typeof import("../../web/convex/_generated/api");

const SITE_SLUG = "diana";
const DOCUMENT_PATH = "/wiki/logistics/insurance";
const ROOM_ID = "markdown:wiki/logistics/insurance";

type LiveThread = {
  id: string;
  roomId: string;
  comments: Array<{ body: unknown }>;
};

async function selectArticleText(page: Page) {
  const quote = await page.evaluate(() => {
    const root = Array.from(document.querySelectorAll<HTMLElement>("article")).find(
      (article) => {
        const rect = article.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
    );
    if (!root) return "";

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return (node.textContent ?? "").trim().length > 40
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const textNode = walker.nextNode() as Text | null;
    if (!textNode?.textContent) return "";

    const start = Math.max(0, textNode.textContent.search(/\S/));
    const end = Math.min(textNode.textContent.length, start + 72);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    return range.toString();
  });

  expect(quote.trim().length).toBeGreaterThan(0);
  return quote;
}

async function liveThreads(request: APIRequestContext) {
  const response = await request.get("/api/liveblocks-threads?fresh=1");
  if (!response.ok()) return [];
  const body = (await response.json()) as { threads?: LiveThread[] };
  return body.threads ?? [];
}

function threadContainsText(thread: LiveThread, text: string) {
  return thread.comments.some((comment) => JSON.stringify(comment.body).includes(text));
}

async function cleanupCommentThreads(
  request: APIRequestContext,
  text: string,
  knownThreadId: string | null,
) {
  const threads = await liveThreads(request);
  const targets = threads.filter(
    (thread) => thread.id === knownThreadId || threadContainsText(thread, text),
  );

  for (const thread of targets) {
    const response = await request.post("/api/liveblocks-delete-thread", {
      data: { roomId: thread.roomId, threadId: thread.id },
    });
    if (!response.ok()) {
      throw new Error(`Liveblocks cleanup failed for ${thread.id}: ${response.status()}`);
    }
  }
}

async function cleanupTestUser(email: string) {
  const convex = new ConvexHttpClient(resolveServerConvexUrl());
  const user = await convex.query(api.users.getByEmailForAuth, {
    email,
    siteSlug: SITE_SLUG,
  });
  if (!user) return;
  await convex.mutation(api.access.deleteUsers, {
    siteSlug: SITE_SLUG,
    userIds: [user._id],
  });
  const remaining = await convex.query(api.users.getByEmailForAuth, {
    email,
    siteSlug: SITE_SLUG,
  });
  if (remaining) {
    throw new Error(`Convex cleanup failed for ${email}`);
  }
}

test("creates an anchored comment, restores its URL, and shows it globally", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await ensurePasswordGateSession(page);

  const configResponse = await page.request.get("/api/liveblocks-auth");
  expect(configResponse.ok()).toBe(true);
  const config = (await configResponse.json()) as {
    configured: boolean;
    reason?: string | null;
  };
  test.skip(
    !config.configured,
    `Liveblocks integration unavailable: ${config.reason ?? "credentials-missing"}`,
  );

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `vite-comments-${suffix}@example.test`;
  const commentText = `Vite launch anchored comment ${suffix}`;
  let signupAttempted = false;
  let signedUp = false;
  let threadId: string | null = null;

  try {
    signupAttempted = true;
    const signup = await page.request.post("/api/auth/signup", {
      data: {
        email,
        name: `Vite Comments ${suffix}`,
        password: "playwright-password",
      },
    });
    expect(signup.ok(), await signup.text()).toBe(true);
    signedUp = true;

    await page.addInitScript(() => {
      window.localStorage.setItem("comments-pane-open", "1");
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(DOCUMENT_PATH, { waitUntil: "domcontentloaded" });
    await expect(documentArticle(page)).toHaveAttribute(
      "data-document-slug",
      "wiki/logistics/insurance",
      { timeout: 45_000 },
    );
    await expect
      .poll(async () => (await documentArticle(page).textContent())?.trim().length ?? 0)
      .toBeGreaterThan(100);
    const commentsTab = page
      .getByRole("button", { name: "Comments", exact: true })
      .last();
    await expect(commentsTab).toBeVisible();
    await commentsTab.click();
    await expect(
      page.getByRole("button", { name: "Add a page-level comment" }),
    ).toHaveCount(0);

    const quote = await selectArticleText(page);
    await expect(page.getByRole("button", { name: "Add comment" })).toBeVisible();
    await page.getByRole("button", { name: "Add comment" }).click();

    const composer = page.getByRole("textbox", { name: "Composer editor" }).last();
    await expect(composer).toBeVisible();
    await composer.fill(commentText);
    await page.getByRole("button", { name: "Send" }).last().click();

    const thread = page
      .locator('[data-comment-list-item="thread"][data-anchor-start]')
      .filter({ hasText: commentText });
    await expect(thread).toBeVisible({ timeout: 20_000 });
    await expect(thread.getByText("Linked selection")).toBeVisible();
    await expect(thread).toContainText(quote.slice(0, 32));
    threadId = await thread.getAttribute("data-thread-id");
    expect(threadId).toBeTruthy();

    await thread.getByText("Linked selection").click();
    await expect(page).toHaveURL(new RegExp(`thread=${threadId}`));
    await expect
      .poll(
        async () =>
          (await liveThreads(page.request)).some(
            (candidate) => candidate.id === threadId,
          ),
        { timeout: 20_000 },
      )
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    const restored = page.locator(`[data-thread-id="${threadId}"]`);
    await expect(restored).toBeVisible({ timeout: 20_000 });
    await expect(restored).toHaveClass(/border-sky/);

    await page.route("**/api/liveblocks-threads**", async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("fresh", "1");
      await route.continue({ url: url.toString() });
    });
    await page.goto("/comments", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "wiki/logistics/insurance" })).toHaveAttribute(
      "href",
      DOCUMENT_PATH,
    );
  } finally {
    if (signedUp) {
      await cleanupCommentThreads(page.request, commentText, threadId);
    }
    if (signupAttempted) {
      await cleanupTestUser(email);
    }
  }

  expect(
    (await liveThreads(page.request)).some((thread) =>
      threadContainsText(thread, commentText),
    ),
  ).toBe(false);
});
