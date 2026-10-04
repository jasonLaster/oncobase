import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(
  !process.env.PLAYWRIGHT_BASE_URL,
  "Requires the public education server.",
);

for (const width of [320, 393, 1440]) {
  test(`public pages follow system colors and remember theme choices at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/education");
    const theme = page.getByRole("button", { name: "Dark theme" });
    await expect(theme).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
    if (width <= 700) {
      const brand = await page.locator(".edu-brand").boundingBox();
      const menu = await page
        .getByRole("button", { name: "Open education navigation" })
        .boundingBox();
      expect(
        Math.abs(brand!.y + brand!.height / 2 - menu!.y - menu!.height / 2),
      ).toBeLessThan(2);
    }
    await expect(page.locator("html")).toHaveClass(/dark/);
    // Light differs from the system, so it is remembered; choosing dark
    // again matches the system and returns to following it.
    for (const [value, pressed, stored] of [
      ["light", "false", "light"],
      ["dark", "true", null],
    ] as const) {
      await theme.click();
      await page.reload();
      await expect(theme).toHaveAttribute("aria-pressed", pressed);
      expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
        stored,
      );
      await expect(
        page.getByRole("heading", { name: "The education library" }),
      ).toBeVisible();
      await page.locator(".edu-topic-card").first().hover();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.playwright/education/theme-${value}-${width}.png`,
        fullPage: true,
      });
    }
    await page.goto("/education/oncology-101/index");
    const article = page.getByTestId("education-article");
    await expect(article.getByRole("heading", { level: 1 })).toBeVisible();
    const link = article
      .locator(".wiki-markdown a:not(.heading-anchor)")
      .first();
    await link.hover();
    const channels = (await link.evaluate((el) => getComputedStyle(el).color))
      .match(/\d+/g)!
      .map(Number);
    expect(channels[1]).toBeGreaterThan(channels[2]!);
    expect(channels[1]).toBeGreaterThan(channels[0]!);
    await page.screenshot({
      path: `.playwright/education/article-dark-${width}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await expect
      .poll(() =>
        page.locator("html").evaluate((el) => el.classList.contains("dark")),
      )
      .toBe(false);
    await page.goto("/login");
    await expect(theme).toHaveAttribute("aria-pressed", "false");
    await theme.click();
    await expect(page.locator(".landing-page")).toHaveCSS(
      "color-scheme",
      "dark",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.playwright/education/landing-dark-${width}.png`,
      fullPage: true,
    });
    expect(await page.locator('a[href^="/wiki/education/"]').count()).toBe(0);
    await page
      .getByRole("link", { name: "Browse educational content" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/education$/);
    await expect(theme).toHaveAttribute("aria-pressed", "true");
  });
}
