import { expect, test } from "@playwright/test";

test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: { "x-wiki-test-run": "1" },
});
test.skip(
  !process.env.PLAYWRIGHT_BASE_URL,
  "Requires the standalone public education server.",
);
const lesson = "/education/oncology-101/index";

test("the library contains every public wiki education page and opens without the care reader", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const manifest = await (await request.get("/api/education/manifest")).json();
  expect(manifest.pages.length).toBeGreaterThan(0);
  const readerRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /\/api\/(?:wiki|auth|timeline|diagnostic-studies|chat)\b/.test(
        new URL(request.url()).pathname,
      )
    )
      readerRequests.push(request.url());
  });
  await page.goto("/education");
  await expect(
    page.getByRole("heading", { name: "Cancer science, made approachable." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The education library" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Education navigation" });
  await expect
    .poll(() => nav.locator('a[href^="/education/"]').count())
    .toBe(manifest.pages.length);
  const hrefs = await nav
    .locator('a[href^="/education/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const entry of manifest.pages)
    expect(hrefs).toContain(
      `/education/${entry.slug.slice("wiki/education/".length).split("/").map(encodeURIComponent).join("/")}`,
    );
  expect(readerRequests).toEqual([]);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) =>
          /LiveStoreRoot|vendor-livestore|livestore\.worker/.test(entry.name),
        ),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "Start learning", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(lesson));
  await expect(
    page.getByRole("heading", { name: /Oncology 101/, level: 1 }),
  ).toBeVisible();
  const cartoon = page.getByRole("img", {
    name: "immune recognition cartoon",
    exact: true,
  });
  await cartoon.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      cartoon.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(cartoon).toHaveAttribute("src", /\/api\/education\//);
  const curriculumLinks = page
    .getByTestId("education-article")
    .locator('a[href^="/wiki/education/"]');
  expect(await curriculumLinks.count()).toBe(0);
  await page.screenshot({
    path: ".playwright/education/article-desktop.png",
    fullPage: true,
  });
});

test("education search stays scoped and browser history restores the library", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto("/education");
  const input = page.getByRole("searchbox", {
    name: "Search education",
    exact: true,
  });
  await expect(input).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeFocused();
  await input.fill("immunotherapy");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/education\/search\?q=immunotherapy$/);
  await expect(
    page.getByRole("heading", {
      name: "Results for “immunotherapy”",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator(".edu-result").count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const response = await (
    await request.get("/api/education/search?q=immunotherapy")
  ).json();
  expect(
    response.results.every((result: { slug: string }) =>
      result.slug.startsWith("wiki/education/"),
    ),
  ).toBe(true);
  await page.locator(".edu-result").first().click();
  await expect(
    page.getByTestId("education-article").getByRole("heading", { level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", {
      name: "Results for “immunotherapy”",
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "The education library" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".playwright/education/library-desktop.png",
    fullPage: true,
  });
});

test("phone navigation, deep links, and protected care content retain their boundaries", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(lesson);
  await expect(
    page.getByRole("heading", { name: /Oncology 101/, level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open education navigation" }).click();
  const nav = page.getByRole("navigation", { name: "Education navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "All topics", exact: true }).click();
  await expect(page).toHaveURL(/\/education$/);
  await expect(
    page.getByRole("button", { name: "Open education navigation" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".edu-topic-card").first()).toBeVisible();
  await page.screenshot({
    path: ".playwright/education/library-mobile.png",
    fullPage: true,
  });
  for (const width of [320, 700, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const endpoint of [
    "/api/timeline",
    "/api/diagnostic-studies",
    "/api/wiki/convex-token",
    "/api/chat",
  ])
    expect((await request.get(endpoint)).status()).toBe(401);
  const html = await request.get(lesson);
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain("Oncobase Education");
  await page.goto("/education/oncology-101?q=immune");
  await expect(page).toHaveURL(/\/education\/oncology-101\/index\?q=immune$/);
  await expect(
    page.getByRole("heading", { name: /Oncology 101/, level: 1 }),
  ).toBeVisible();
  await page.goto("/wiki/care/index");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
});
