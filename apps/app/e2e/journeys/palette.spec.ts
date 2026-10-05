import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Mocked command-palette modes and semantics the real-backend find journey does not cover. */
test.describe("command palette (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("Cmd+K opens before the chord timeout and expiry preserves typed text", async ({ page }) => {
    await gotoWiki(page, "/");
    // Prepare the module so this checks the shortcut delay independently of
    // network speed. Advance only 100 ms, well short of the 600 ms chord window.
    await page.getByTestId("sidebar-search").click();
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await input.press("Escape");
    const clockStart = new Date("2026-09-27T00:00:00Z");
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
    await page.keyboard.press(`${mod}+K`);
    await page.clock.runFor(100);
    await expect(input).toBeFocused();
    await input.fill("insurance");
    await page.clock.runFor(1000);
    await expect(input).toHaveValue("insurance");
    await input.press("Escape");
    await page.clock.runFor(1000);
    await expect(input).toHaveCount(0);
  });

  test("chords open the outline and action modes, outline jumps to a heading, and tag mode filters pages", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(`${mod}+K`);
    await page.keyboard.press("O");
    await expect(page.getByTestId("command-palette-input")).toHaveAttribute("placeholder", "Find a heading");
    await page
      .getByTestId("command-palette")
      .getByRole("button", { name: /Claims follow-up/ })
      .click();
    await expect(page).toHaveURL(/#claims-follow-up$/);

    await page.keyboard.press(`${mod}+K`);
    await page.keyboard.press("A");
    await expect(page.getByTestId("command-palette-input")).toHaveAttribute("placeholder", "Search commands...");
    await page.getByRole("button", { name: /Browse tags/ }).click();
    await page.getByTestId("command-palette-input").fill("logistics");
    await page.getByTestId("command-palette").getByRole("button", { name: /logistics/ }).click();
    await expect(page.getByTestId("command-palette-input")).toHaveValue("logistics");
    await expect(page.getByTestId("command-palette").getByRole("option", { name: /insurance/i })).toBeVisible();
  });

  test("action mode lists backend links and current-page source files, and browses source PDFs", async ({ page }) => {
    await gotoWiki(page, "/sources/people/providers/stanford/telli");

    await page.keyboard.press(`${mod}+Shift+K`);
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("link", { name: /Search wiki/ })).toHaveAttribute(
      "href",
      /\/search\?returnTo=%2Fsources%2Fpeople%2Fproviders%2Fstanford%2Ftelli$/,
    );
    await expect(palette.getByRole("link", { name: /New chat/ })).toHaveAttribute("href", /\/chat\?returnTo=/);
    await expect(palette.getByRole("link", { name: /Download markdown archive/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=markdown&scope=public$/,
    );
    await expect(palette.getByRole("link", { name: /Open telli-2016-hrd-platinum-tnbc\.pdf/ })).toHaveAttribute(
      "href",
      /\/api\/file\?path=sources%2Fpeople%2Fproviders%2Fstanford%2Ftelli%2Ftelli-2016-hrd-platinum-tnbc\.pdf/,
    );

    await palette.getByRole("button", { name: /Browse source PDFs/ }).click();
    await page.getByTestId("command-palette-input").fill("telli");
    await expect(palette.getByRole("link", { name: /telli-2016-hrd/ })).toHaveAttribute(
      "href",
      /\/api\/file\?path=sources%2Fpeople%2Fproviders%2Fstanford/,
    );
    await page.getByTestId("command-palette-input").fill("pathology");
    await expect(palette).toContainText("No source PDFs found");
  });

  test("recent mode groups remembered pages above all pages and reopens one", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "index", exact: true }).click();
    await waitForPageTitle(page, "Diana Wiki Home");

    await page.getByTestId("sidebar-search").click();
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByText("Recent pages")).toBeVisible();
    await expect(palette.getByText("All pages")).toBeVisible();
    await expect(palette.getByRole("option").first()).toHaveAttribute("data-value", /insurance/);
    await palette.getByRole("option", { name: /insurance/i }).first().click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
  });

  test("the palette is a modal combobox with active-descendant semantics, resets scroll, and restores its trigger", async ({ page }) => {
    await gotoWiki(page, "/");
    await page.evaluate(() => localStorage.removeItem("cmd-palette-recent"));

    const trigger = page.getByTestId("sidebar-search");
    await trigger.focus();
    await trigger.click();
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-controls", "page-palette-list");
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");

    const listbox = page.locator("#page-palette-list");
    await expect.poll(() => listbox.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await listbox.evaluate((el) => {
      el.scrollTop = 600;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(() => listbox.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("option").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");

    await trigger.click();
    await expect.poll(() => page.locator("#page-palette-list").evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("a complete page title ranks first, and a notes bundle opens its overview from the palette", async ({ page }) => {
    const slug = "sources/research/papers/breast-sensation/index";
    const title = "Breast sensation after surgery";
    const notes = "sources/meeting-notes/09-13---care-planning";
    await installWikiApiMocks(page, {
      pageOverrides: {
        [slug]: { title, tags: [], content: `# ${title}` },
        "wiki/questions/surgery": {
          title: "Breast sensation after surgery: what should patients expect?",
          tags: [],
          content: "# Surgery questions",
        },
        ...Object.fromEntries(
          ["raw", "formatted", "overview"].map((part) => [
            `${notes}-${part}`,
            { title: `Care planning ${part}`, tags: [], content: `# Care planning ${part}` },
          ]),
        ),
      },
    });
    await gotoWiki(page, "/");
    await page.evaluate(() => {
      localStorage.setItem("cmd-palette-recent", JSON.stringify(["wiki/questions/surgery"]));
    });
    await page.getByTestId("sidebar-search").click();
    const palette = page.getByTestId("command-palette");
    const input = page.getByTestId("command-palette-input");
    for (const query of [title, `${title} should`]) {
      await input.fill(query);
      await expect(palette.getByRole("option").first()).toHaveAttribute("data-value", slug);
    }
    await input.fill("care planning");
    await expect(palette.getByRole("option")).toHaveCount(1);
    await expect(palette.getByRole("option")).toHaveAttribute("data-value", `${notes}-overview`);
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${notes}-overview$`));
    await waitForPageTitle(page, "Care planning overview");
  });
});
