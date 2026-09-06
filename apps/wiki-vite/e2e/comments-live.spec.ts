import { createRequire } from "node:module";
import { type APIRequestContext, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expect, test, signIn, checkpoint, article as documentArticle } from "../parity-e2e/fixtures";
import { ConvexHttpClient } from "convex/browser";

const { api } = createRequire(import.meta.url)(
  "../convex/_generated/api.js",
) as typeof import("../convex/_generated/api");

const SITE_SLUG = "diana";
const DOCUMENT_PATH = "/wiki/logistics/insurance";
const ROOM_ID = "markdown:wiki/logistics/insurance";

type LiveThread = {
  id: string;
  roomId: string;
  comments: Array<{ body: unknown }>;
};

async function selectArticleText(page: Page) {
  const prose = documentArticle(page).locator("p").filter({ visible: true }).first();
  await prose.scrollIntoViewIfNeeded();
  const bounds = (await prose.boundingBox())!;
  await page.mouse.move(bounds.x + 8, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + Math.min(bounds.width - 8, 340), bounds.y + 10, { steps: 12 });
  await page.mouse.up();
  const quote = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(quote.trim().length).toBeGreaterThan(0);
  return quote;
}

async function liveThreads(request: APIRequestContext) {
  const response = await request.get("/api/liveblocks-threads?fresh=1");
  expect(response.ok(), "Real comment read must not masquerade as an empty list").toBe(true);
  const body = (await response.json()) as { threads?: LiveThread[] };
  expect(Array.isArray(body.threads)).toBe(true);
  return body.threads!;
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
    (thread) => thread.roomId === ROOM_ID && threadContainsText(thread, text),
  );
  if (knownThreadId && threads.some((thread) => thread.id === knownThreadId)) {
    expect(targets.some((thread) => thread.id === knownThreadId), "Cleanup must prove ownership, not just match an ID").toBe(true);
  }

  for (const thread of targets) {
    expect(thread.comments, "Do not delete a test thread that acquired someone else's reply").toHaveLength(1);
    const response = await request.post("/api/liveblocks-delete-thread", {
      data: { roomId: thread.roomId, threadId: thread.id },
    });
    if (!response.ok()) {
      throw new Error(`Liveblocks cleanup failed for ${thread.id}: ${response.status()}`);
    }
  }
  await expect.poll(async () => (await liveThreads(request)).some((thread) => threadContainsText(thread, text))).toBe(false);
}

async function cleanupTestUser(email: string) {
  const convex = new ConvexHttpClient(process.env.PARITY_CONVEX_URL!);
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
}, info) => {
  test.setTimeout(150_000);
  await signIn(page);

  const configResponse = await page.request.get("/api/liveblocks-auth");
  expect(configResponse.ok()).toBe(true);
  const config = (await configResponse.json()) as {
    configured: boolean;
    reason?: string | null;
  };
  expect(config.configured, `Liveblocks integration unavailable: ${config.reason ?? "credentials-missing"}`).toBe(true);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `vite-comments-${suffix}@example.test`;
  const commentText = `Vite launch anchored comment ${suffix}`;
  let signupAttempted = false;
  let signedUp = false;
  let threadId: string | null = null;
  const journal = info.outputPath("backend-cleanup.json");
  const record = (state: string) => writeFile(journal, JSON.stringify({
    state, email, commentText, roomId: ROOM_ID, threadId, baseURL: info.project.use.baseURL,
  }, null, 2));
  const convex = new ConvexHttpClient(process.env.PARITY_CONVEX_URL!);
  expect(await convex.query(api.users.getByEmailForAuth, { email, siteSlug: SITE_SLUG })).toBeNull();
  await record("pending");

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
    // The outline fallback is replaced after real Liveblocks initialization.
    // Selecting text in that fallback loses the selection on the replacement.
    await expect(documentArticle(page).locator("[data-comment-highlight-layer]")).toHaveCount(1);
    const quote = await selectArticleText(page);
    await expect(page.getByRole("button", { name: "Add comment" })).toBeVisible();
    await page.getByRole("button", { name: "Add comment" }).click();

    const composer = page.getByRole("textbox", { name: "Composer editor" }).last();
    await expect(composer).toBeVisible();
    await composer.fill(commentText);
    await page.getByRole("button", { name: "Send" }).last().click();

    const thread = page
      .locator('[data-comment-list-item="thread"][data-anchor-start]')
      .filter({ hasText: commentText, visible: true });
    await expect(thread).toBeVisible({ timeout: 20_000 });
    await expect(thread.getByText("Linked selection")).toBeVisible();
    await expect(thread).toContainText(quote.slice(0, 32));
    threadId = await thread.getAttribute("data-thread-id");
    expect(threadId).toBeTruthy();
    await record("pending");

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
    await checkpoint(page, info, "comment-persisted");

    await page.reload({ waitUntil: "domcontentloaded" });
    const restored = page.locator(`[data-comment-list-item="thread"][data-thread-id="${threadId}"]`).filter({ visible: true });
    await expect(restored).toBeVisible({ timeout: 20_000 });
    await expect(restored).toHaveClass(/border-sky/);
    await checkpoint(page, info, "comment-restored");

    await page.goto("/comments", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "wiki/logistics/insurance" })).toHaveAttribute(
      "href",
      DOCUMENT_PATH,
    );
    await checkpoint(page, info, "comment-global");
  } finally {
    // The API context survives page closure. Disconnect Liveblocks before
    // cleanup so the browser cannot enqueue further comment changes.
    if (!page.isClosed()) {
      // Diagnostic capture must never prevent cleanup after a browser failure.
      try { await info.attach("before-cleanup", { body: await page.screenshot(), contentType: "image/png" }); }
      catch { /* The trace still records events preceding a browser failure. */ }
      await page.close({ runBeforeUnload: false }).catch(() => {});
    }
    try {
      if (signedUp) {
        await cleanupCommentThreads(page.request, commentText, threadId);
      }
      if (signupAttempted) {
        await cleanupTestUser(email);
      }
      await record("clean");
    } catch (error) {
      await record("cleanup-failed");
      throw error;
    } finally {
      await info.attach("backend-cleanup", { path: journal, contentType: "application/json" });
    }
  }
});
