import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

for (const width of [320, 393, 700, 701, 900, 901, 1440, 1920]) {
  test(`landing page reflows without overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 700 ? 852 : 1000 });
    await page.goto("/login");
    await expect(
      page.getByRole("heading", {
        name: "For Diana. With all of us.",
        level: 1,
      }),
    ).toBeVisible();
    const preview = page.getByTestId("platform-preview");
    const box = await preview.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const cards = page.locator(".lp-feature-card");
    expect(await cards.count()).toBe(4);
    if (width <= 900) {
      for (let index = 1; index < 4; index++) {
        const previous = await cards.nth(index - 1).boundingBox();
        const current = await cards.nth(index).boundingBox();
        expect(current!.x).toBe(previous!.x);
        expect(current!.y).toBeGreaterThanOrEqual(
          previous!.y + previous!.height + 19,
        );
      }
    } else {
      const illustrations = page.locator(".lp-feature-art");
      expect((await illustrations.nth(0).boundingBox())!.y).toBe(
        (await illustrations.nth(1).boundingBox())!.y,
      );
    }
    if (width <= 700) {
      for (const tab of await page.getByRole("tab").all()) {
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
}

test("preview tabs support click and keyboard navigation without requesting clinical data", async ({
  page,
}) => {
  const readerRequests: string[] = [];
  await page.route("**/api/wiki/**", async (route) => {
    readerRequests.push(route.request().url());
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.goto("/login");
  await page.getByRole("tab", { name: "Collaboration", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Collaboration", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Molecular analysis", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Molecular analysis", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tabpanel", { name: "Education", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tabpanel", { name: "Knowledge", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  expect(readerRequests).toEqual([]);
});

test("landing navigation reaches features, story, and sign-in", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("link", { name: "Enter Diana’s knowledge base", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toBeInViewport();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Oncobase", exact: true })
    .click();
  await expect(page.locator("#platform-title")).toBeInViewport();
  await page.getByRole("link", { name: "Explore the platform" }).click();
  await expect(page.locator("#features-title")).toBeInViewport();
  await page.getByRole("link", { name: "Our story", exact: true }).click();
  await expect(page.locator("#story-title")).toBeInViewport();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeInViewport();
});

test("sign-in reports connection and server failures and allows a retry", async ({
  page,
}) => {
  let attempt = 0;
  await page.route("**/api/login", async (route) => {
    attempt++;
    if (attempt === 1) await route.abort("failed");
    else await route.fulfill({ status: 503, body: "{}" });
  });
  await page.goto("/login#sign-in");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page
    .getByRole("button", { name: "Enter Diana’s knowledge base", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to connect. Please try again.",
  );
  await expect(
    page.getByRole("button", {
      name: "Enter Diana’s knowledge base",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Enter Diana’s knowledge base", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign in is temporarily unavailable. Please try again.",
  );
});

test("the wiki snapshot links to real Diana sections and showcase assets load", async ({
  page,
}) => {
  const failedAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/landing/") && !response.ok())
      failedAssets.push(response.url());
  });
  await page.goto("/login");
  const snapshot = page.getByRole("tabpanel", {
    name: "Knowledge",
    exact: true,
  });
  await expect(
    snapshot.getByRole("link", { name: "Learning guides", exact: true }),
  ).toHaveAttribute("href", "/wiki/education/index");
  await expect(
    snapshot.getByRole("link", {
      name: "Original reports and sources",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://diana-tnbc.com/sources/index");
  await page.locator("#inside").scrollIntoViewIfNeeded();
  const images = page.locator("#inside img");
  expect(await images.count()).toBe(6);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  expect(failedAssets).toEqual([]);
});

test("PII example changes inline details while preserving surrounding context", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Collaboration", exact: true }).click();
  const panel = page.getByRole("tabpanel", {
    name: "Collaboration",
    exact: true,
  });
  const toggle = panel.getByRole("switch", {
    name: "Redact example personal information",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(
    panel.getByText("[redacted email]", { exact: true }),
  ).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    panel.getByText("alex@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(
      "The next conversation will focus on the report’s evidence, limitations, and open questions.",
    ),
  ).toBeVisible();
  await toggle.click();
  await expect(
    panel.getByText("[redacted email]", { exact: true }),
  ).toBeVisible();
});

test("role preview shows different page visibility with thumb-friendly controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/login");
  const picker = page.getByRole("group", {
    name: "Preview an example user role",
  });
  for (const button of await picker.getByRole("button").all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await picker
    .getByRole("button", { name: "Friends & family", exact: true })
    .click();
  await expect(
    picker.getByRole("button", { name: "Friends & family", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const pages = page.getByRole("list", {
    name: "Page visibility for Friends & family",
  });
  await expect(
    pages.getByRole("listitem").filter({ hasText: "Clinical records" }),
  ).toContainText("Hidden");
  await expect(
    pages.getByRole("listitem").filter({ hasText: "Learning guides" }),
  ).toContainText("Viewable");
  await picker.getByRole("button", { name: "Care team", exact: true }).click();
  await expect(
    page
      .getByRole("list", { name: "Page visibility for Care team" })
      .getByRole("listitem")
      .filter({ hasText: "Clinical records" }),
  ).toContainText("Viewable");
});
