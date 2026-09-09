import { expect, test, type Page } from "@playwright/test";

// Real production responses only. Delay gates hold real scripts; they never
// replace API data. These tests do not submit chats, comments, or other writes.
const articlePath = "/wiki/research/reviews/breast-conservation-survival";
const insurancePath = "/wiki/logistics/insurance";
const article = (page: Page) => page.locator('#root [data-test-id="document-article"]');
const input = (page: Page) => page.getByTestId("command-palette-input");
const phone = (page: Page) => page.viewportSize()!.width < 768;

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedResponses: { path: string; status: number }[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === "https://diana-tnbc.com" && response.status() >= 500) {
      failedResponses.push({ path: url.pathname, status: response.status() });
    }
  });
  runtime.set(page, { errors, failedResponses, timings: {} });
  const login = await page.request.post("/api/login", {
    data: { password: process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  // Keep source text and signed sessions out of the console and public repo.
  testInfo.annotations.push({ type: "production", description: "real backend, read-only UI flows" });
});

const runtime = new WeakMap<Page, {
  errors: string[];
  failedResponses: { path: string; status: number }[];
  timings: Record<string, number>;
}>();

test.afterEach(async ({ page }, testInfo) => {
  const result = runtime.get(page)!;
  await testInfo.attach("runtime-results", { body: JSON.stringify(result), contentType: "application/json" });
  expect(result.errors, "Unhandled browser exceptions").toEqual([]);
  expect(result.failedResponses, "Production 5xx responses").toEqual([]);
});

async function ready(page: Page) {
  await expect(article(page).locator(".wiki-markdown")).toBeVisible();
  await expect(page.locator("#wiki-html-first")).toHaveCount(0);
  await expect(page.getByTestId("store-startup-recovery")).toHaveCount(0);
}

async function timed(page: Page, label: string, action: () => Promise<unknown>) {
  const start = Date.now();
  await action();
  runtime.get(page)!.timings[label] = Date.now() - start;
}

async function chooseInsurance(page: Page) {
  await expect(input(page)).toBeFocused();
  await input(page).fill("insurance");
  await page.locator('[role="option"][data-value="wiki/logistics/insurance"]').click();
  await expect(page).toHaveURL(new RegExp(`${insurancePath}$`));
  await expect(article(page).locator("h1").first()).toContainText(/insurance/i);
  await expect(input(page)).toHaveCount(0);
}

for (const path of [articlePath, "/"]) {
  for (const shortcut of ["Meta+K", "Meta+O"]) {
    test(`refresh ${path === "/" ? "home" : "article"} then early ${shortcut}`, async ({ page }) => {
      let paused = false;
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/*", async route => {
        if (paused && route.request().resourceType() === "script") await held;
        await route.fallback();
      });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await ready(page);
      paused = true;
      try {
        await page.reload({ waitUntil: "commit" });
        await expect(page.locator("#wiki-reader-shortcuts")).toHaveCount(1);
        await page.keyboard.press(shortcut);
        await timed(page, "queued-shortcut-to-focus-ms", async () => {
          release();
          await expect(input(page)).toBeFocused();
        });
        await chooseInsurance(page);
        await timed(page, "warm-shortcut-to-focus-ms", async () => {
          await page.keyboard.press(shortcut);
          await expect(input(page)).toBeFocused({ timeout: 500 });
        });
        await page.keyboard.press("Escape");
        await expect(input(page)).toHaveCount(0);
      } finally { release(); }
    });
  }
}

test("early Search click opens files and keeps the current route", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto(articlePath, { waitUntil: "domcontentloaded" });
    if (!phone(page)) {
      const nativeTree = page.locator("#wiki-html-first .wiki-shell-tree-link:visible");
      expect(await nativeTree.count()).toBeGreaterThan(2);
    }
    await page.locator("#wiki-html-first [data-reader-file-palette]:visible").click();
    expect(new URL(page.url()).pathname).toBe(articlePath);
    await timed(page, "early-search-to-focus-ms", async () => {
      release();
      await expect(input(page)).toBeFocused();
    });
    await expect(page.getByRole("dialog", { name: "Go to page" })).toBeVisible();
    await chooseInsurance(page);
  } finally { release(); }
});

test("early Ask wiki navigates with reader scripts still pending", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto(articlePath, { waitUntil: "domcontentloaded" });
    const destination = page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).pathname === "/chat");
    await timed(page, "ask-click-to-navigation-request-ms", async () => {
      await page.locator('#wiki-html-first a[href="/chat"]:visible').click({ noWaitAfter: true });
      await destination;
    });
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator("#wiki-html-first")).toHaveCount(0);
    await timed(page, "chat-document-to-composer-ms", async () => {
      release();
      await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    });
    await page.getByTestId("chat-composer-textarea").fill("Production navigation check — unsent");
    await expect(page.getByTestId("chat-submit-button")).toBeEnabled();
    await page.getByTestId("chat-composer-textarea").clear();
  } finally { release(); }
});

test("interactive Ask wiki switches before chat downloads; history and composer work", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/assets/ChatPage-*.js", async route => { await held; await route.fallback(); });
  try {
    await page.goto(articlePath, { waitUntil: "domcontentloaded" });
    await ready(page);
    await timed(page, "ask-click-to-chat-shell-ms", async () => {
      await page.getByTestId(phone(page) ? "mobile-ask-wiki" : "sidebar-ask-wiki").click();
      await expect(page.getByRole("status", { name: "Loading chat", exact: true })).toBeVisible({ timeout: 500 });
      await expect(article(page)).toBeHidden({ timeout: 500 });
    });
    await expect(page).toHaveURL(/\/chat$/);
    await page.goBack();
    await ready(page);
    release();
    await page.goForward();
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    await page.getByTestId("chat-composer-textarea").fill("Production navigation check — unsent");
    await expect(page.getByTestId("chat-submit-button")).toBeEnabled();
    await page.getByTestId("chat-composer-textarea").clear();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
  } finally { release(); }
});

test("ready reader shortcuts, chords, focus, typing and footer Search", async ({ page }) => {
  await page.goto(insurancePath, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.getByTestId(phone(page) ? "mobile-header-search" : "sidebar-search").click();
  await expect(input(page)).toBeFocused();
  await input(page).press("Escape");
  for (const shortcut of ["Meta+K", "Meta+O", "Control+K", "Control+O"]) {
    await timed(page, `${shortcut}-focus-ms`, async () => {
      await page.keyboard.press(shortcut);
      await expect(input(page)).toBeFocused({ timeout: 500 });
    });
    await input(page).fill("insurance");
    await page.waitForTimeout(650);
    await expect(input(page)).toHaveValue("insurance");
    await input(page).press("Escape");
    await page.waitForTimeout(650);
    await expect(input(page)).toHaveCount(0);
  }
  for (const [key, placeholder] of [["O", "Find a heading"], ["A", "Search commands..."]]) {
    await page.keyboard.press("Meta+K");
    await page.keyboard.press(key);
    await expect(input(page)).toHaveAttribute("placeholder", placeholder);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("Meta+Shift+K");
  await expect(input(page)).toHaveAttribute("placeholder", "Search commands...");
  await page.keyboard.press("Escape");
});

test("file tree, article layout and palette navigation survive browser history", async ({ page }, testInfo) => {
  await timed(page, "cold-document-to-interactive-ms", async () => {
    await page.goto(articlePath, { waitUntil: "domcontentloaded" });
    await ready(page);
  });
  if (phone(page)) await page.getByTestId("bottom-nav-trigger").click();
  const tree = phone(page) ? page.getByTestId("bottom-nav-page-tree") : page.getByTestId("wiki-sidebar");
  await expect(tree).toBeVisible();
  expect(await tree.locator("a[href]").count()).toBeGreaterThan(2);
  if (phone(page)) await page.keyboard.press("Escape");
  const layout = await article(page).evaluate(el => ({
    width: el.getBoundingClientRect().width,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
    paragraphLineHeight: getComputedStyle(el.querySelector(".wiki-markdown p")!).lineHeight,
  }));
  expect(layout.width).toBeGreaterThan(250);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
  expect(parseFloat(layout.paragraphLineHeight)).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath("reader.png") });
  await page.keyboard.press("Meta+O");
  await chooseInsurance(page);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  await ready(page);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${insurancePath}$`));
  await ready(page);
});

test("theme persists across reload and outline jumps to its heading", async ({ page }, testInfo) => {
  await page.goto(insurancePath, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("Meta+Shift+K");
  await input(page).fill("Switch to Dark theme");
  await page.getByRole("button", { name: /Switch to Dark theme/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("reader-dark.png") });
  await timed(page, "outline-open-to-results-ms", async () => {
    await page.keyboard.press("Meta+Shift+O");
    await expect(input(page)).toHaveAttribute("placeholder", "Find a heading");
    await expect(page.locator("#command-outline-0")).toBeVisible();
  });
  await input(page).press("Enter");
  await expect(input(page)).toHaveCount(0);
  expect(new URL(page.url()).hash.length).toBeGreaterThan(1);
  await page.keyboard.press("Meta+Shift+K");
  await input(page).fill("Switch to Light theme");
  await page.getByRole("button", { name: /Switch to Light theme/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("an unavailable page accepts an early file shortcut", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    await page.goto("/__production_reader_missing__", { waitUntil: "commit" });
    await expect(page.locator("#wiki-reader-shortcuts")).toHaveCount(1);
    await page.keyboard.press("Meta+K");
    release();
    await chooseInsurance(page);
  } finally { release(); }
});
