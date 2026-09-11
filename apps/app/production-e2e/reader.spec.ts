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

test("client-rendered documents retain the password gate and reject retired cache URLs", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    for (const path of ["/", articlePath]) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(new URL(response.headers().location, baseURL).pathname).toBe("/login");
    }
    // The production edge and function both reject this retired namespace.
    if (new URL(baseURL!).hostname === "diana-tnbc.com") {
      expect((await anonymous.get("/__reader/html/retired", { maxRedirects: 0 })).status()).toBe(404);
    }
  } finally { await anonymous.dispose(); }
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

test("cold startup exposes only React controls; Search opens files in place", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await held;
    await route.fallback();
  });
  try {
    const response = await page.goto(articlePath, { waitUntil: "commit" });
    const html = await response!.text();
    expect(html).not.toContain('id="wiki-html-first"');
    expect(html).not.toContain('id="wiki-first-frame-snapshot"');
    await expect(page.locator("#root")).toHaveCount(1);
    await expect(page.locator("#root")).toBeEmpty();
    release();
    await ready(page);
    await page.getByTestId(phone(page) ? "mobile-header-search" : "sidebar-search").click();
    await expect(input(page)).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(articlePath);
    await chooseInsurance(page);
  } finally { release(); }
});

test("Ask wiki works on a cold client-rendered page", async ({ page }) => {
  await page.goto(articlePath, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.getByTestId(phone(page) ? "mobile-ask-wiki" : "sidebar-ask-wiki").click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
  await page.getByTestId("chat-composer-textarea").fill("Production navigation check — unsent");
  await expect(page.getByTestId("chat-submit-button")).toBeEnabled();
  await page.getByTestId("chat-composer-textarea").clear();
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

async function visibleSignIn(page: Page) {
  if (phone(page)) await page.getByRole("button", { name: "Open page navigation", exact: true }).click();
  return page.getByTestId("sidebar-sign-in").filter({ visible: true });
}

test("Search preserves sign in; account dialog opens in place and traps focus", async ({ page }) => {
  await page.goto(articlePath, { waitUntil: "domcontentloaded" });
  await ready(page);
  const signIn = await visibleSignIn(page);
  await expect(signIn).toBeVisible();
  // Phone navigation is dismissed before opening the global palette.
  if (phone(page)) await page.keyboard.press("Escape");
  await page.getByTestId(phone(page) ? "mobile-header-search" : "sidebar-search").click();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Escape");
  const prompt = await visibleSignIn(page);
  await expect(prompt).toBeVisible();
  await prompt.click();
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(articlePath);
  expect(new URL(page.url()).search).toBe("");
  await dialog.getByLabel("Email", { exact: true }).fill("unsent-reader@example.test");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Need an account? Sign up" })).toBeFocused();
  await dialog.getByRole("button", { name: "Need an account? Sign up" }).click();
  await expect(page.getByRole("dialog", { name: "Sign up", exact: true }).getByLabel("Name", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
  await expect(prompt).toBeVisible();
  await expect(prompt).toBeFocused();
});

test("Sign in opens in place on a cold client-rendered page", async ({ page }) => {
  await page.goto(articlePath, { waitUntil: "domcontentloaded" });
  await ready(page);
  await (await visibleSignIn(page)).click();
  expect(new URL(page.url()).pathname).toBe(articlePath);
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByTestId("wiki-auth-dialog").getByLabel("Email", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-sign-in").filter({ visible: true })).toBeVisible();
});

test("saved folder collapse survives refresh and early Search without changing the sidebar", async ({ page }) => {
  test.skip(phone(page), "Desktop saved tree state; phone navigation is covered in the reader tests.");
  await page.goto(articlePath, { waitUntil: "domcontentloaded" });
  await ready(page);
  const tree = page.getByTestId("wiki-sidebar");
  await tree.getByRole("button", { name: "Collapse wiki", exact: true }).click();
  await expect(tree.getByRole("button", { name: "Expand wiki", exact: true })).toBeVisible();
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "script") await scripts;
    await route.fallback();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("#root")).toHaveCount(1);
    await expect(page.locator("#root")).toBeEmpty();
    await expect(page.locator("#wiki-html-first, #wiki-first-frame-snapshot")).toHaveCount(0);
    release();
    await ready(page);
    await expect(tree.getByRole("button", { name: "Expand wiki", exact: true })).toBeVisible();
    await page.getByTestId("sidebar-search").click();
    await expect(input(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tree.getByRole("button", { name: "Expand wiki", exact: true })).toBeVisible();
    await expect(page.getByTestId("sidebar-sign-in").filter({ visible: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(articlePath);
  } finally { release(); }
});
