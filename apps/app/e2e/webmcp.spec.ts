import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";
import { callTool, installModelContextStub, toolNames } from "./webmcp-stub";

test.describe("WebMCP reader tools", () => {
  test.beforeEach(async ({ page }) => {
    await installModelContextStub(page);
  });

  test("registers the tool set and reads, browses and searches the wiki", async ({ page }) => {
    await installWikiApiMocks(page);
    await page.route("**/api/search?**", route => route.fulfill({ json: { results: [
      { slug: "wiki/logistics/insurance", filePath: "wiki/logistics/insurance.md", title: "Insurance", matches: [{ lineNumber: 7, lineContent: "Keep the current payer, oncology office, and imaging center aligned before scheduled care.", matchStart: 9, matchEnd: 14 }] },
    ] } }));
    await gotoWiki(page, "/wiki/logistics/insurance");
    await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
      "ask_wiki_chat", "browse", "get_current_view", "get_pages_by_tag", "get_related_pages", "list_source_files", "list_tags",
      "open_page", "open_search", "open_source_file", "open_tag", "read_page", "recent_pages", "search_wiki", "show_passage",
    ]));

    const view = await callTool(page, "get_current_view");
    expect(view).toMatchObject({ screen: "page", page: { slug: "wiki/logistics/insurance", title: "Insurance" } });
    expect(view.outline.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(["prior-authorization", "claims-follow-up"]));

    const section = await callTool(page, "read_page", { slug: "wiki/logistics/insurance", section: "Prior authorization" });
    expect(section.content).toMatch(/^## Prior authorization\n\nKeep the current payer/);
    expect(section.content).not.toContain("Claims follow-up");

    const top = await callTool(page, "browse");
    expect(top.entries.some((entry: { type: string; name: string }) => entry.type === "folder" && entry.name === "wiki")).toBe(true);
    expect((await callTool(page, "list_tags")).tags).toEqual(expect.arrayContaining([{ tag: "insurance", pages: 1 }]));

    const hits = await callTool(page, "search_wiki", { query: "payer" });
    expect(hits.results[0]).toMatchObject({ slug: "wiki/logistics/insurance", matches: [{ line: 7, section_href: "/wiki/logistics/insurance#prior-authorization" }] });
  });

  test("drives the reader: opens sections, highlights passages, opens search and chat", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    const opened = await callTool(page, "open_page", { slug: "wiki/logistics/insurance", section: "Claims follow-up" });
    expect(opened).toMatchObject({ opened: true, href: "/wiki/logistics/insurance#claims-follow-up" });
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance#claims-follow-up$/);

    const shown = await callTool(page, "show_passage", { quote: "track follow-up calls and documents" });
    expect(shown).toMatchObject({ found: true, slug: "wiki/logistics/insurance" });
    await expect(page.locator("[data-webmcp-highlight]")).toContainText("Use this section to track follow-up calls");
    expect((await callTool(page, "show_passage", { quote: "this sentence is not on the page" })).found).toBe(false);

    await callTool(page, "open_search", { query: "prior authorization", mode: "text" });
    await expect(page).toHaveURL(/\/search\?q=prior\+authorization&tab=text$/);

    expect((await callTool(page, "open_page", { slug: "does/not/exist" })).error).toContain("search_wiki");
    await callTool(page, "ask_wiki_chat", { question: "What needs prior authorization?" });
    await expect(page).toHaveURL(/\/chat(?:\?q=What\+needs\+prior\+authorization%3F|\/)/);
  });

  test("private pages stay withheld from agents until the reader allows it in the palette", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/private/plan?scope=session");
    await expect.poll(() => toolNames(page)).toContain("read_page");

    const denied = await callTool(page, "read_page", { slug: "private/plan" });
    expect(denied).toMatchObject({ slug: "private/plan", private: true, content: null });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+k" : "Control+Shift+k");
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await input.fill("AI agents");
    await page.getByText("Allow AI agents to read private pages", { exact: true }).click();

    await expect.poll(async () => (await callTool(page, "read_page", { slug: "private/plan" })).content).toEqual(expect.any(String));
    expect((await callTool(page, "get_current_view")).private_pages_allowed).toBe(true);
  });
});

test.describe("WebMCP education tools", () => {
  const lesson = {
    slug: "wiki/education/oncology-101/index",
    title: "Oncology 101",
    content: "# Oncology 101\n\nCancer starts when cells stop listening to the signals that keep growth in check.\n\n## Vaccines\n\nA cancer vaccine teaches the immune system to recognize tumor antigens.\n",
  };
  test.beforeEach(async ({ page }) => {
    await installModelContextStub(page);
    await page.route("**/api/education/manifest**", route => route.fulfill({ json: {
      schemaVersion: 1, siteSlug: "diana", manifestHash: "edu", generatedAt: "2026-11-14T00:00:00.000Z", scope: "public",
      compactTree: [], assets: [],
      pages: [{ slug: lesson.slug, title: lesson.title, tags: ["education"], description: "Start here.", contentHash: "h", sensitive: false, size: lesson.content.length }],
    } }));
    await page.route("**/api/education/pages**", route => route.fulfill({ json: {
      siteSlug: "diana", generatedAt: "2026-11-14T00:00:00.000Z", scope: "public", isDone: true, continueCursor: null,
      pages: [{ ...lesson, tags: ["education"], contentHash: "h", sensitive: false, size: lesson.content.length }],
    } }));
    await page.route("**/api/education/search**", route => route.fulfill({ json: { results: [
      { slug: lesson.slug, title: lesson.title, matches: [{ lineNumber: 7, lineContent: "A cancer vaccine teaches the immune system to recognize tumor antigens.", matchStart: 9, matchEnd: 16 }] },
    ] } }));
  });

  test("guests' agents search, read, open and highlight education lessons", async ({ page }) => {
    await page.goto("/education");
    await expect(page.getByTestId("education-app")).toBeVisible();
    await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
      "get_current_view", "list_lessons", "open_page", "read_page", "search_education", "show_passage",
    ]));
    await expect.poll(async () => (await callTool(page, "list_lessons")).lessons?.length ?? 0).toBe(1);

    const search = await callTool(page, "search_education", { query: "vaccine" });
    expect(search.results[0]).toMatchObject({ slug: lesson.slug });
    const read = await callTool(page, "read_page", { slug: lesson.slug, section: "Vaccines" });
    expect(read.text).toContain("tumor antigens");
    expect(read.text).not.toContain("stop listening");

    expect((await callTool(page, "open_page", { slug: lesson.slug, section: "Vaccines" })).error).toBeUndefined();
    await expect(page.getByTestId("education-article")).toBeVisible();
    await expect(page).toHaveURL(/\/education\/oncology-101(?:\/index)?#vaccines$/);
    const shown = await callTool(page, "show_passage", { quote: "teaches the immune system" });
    expect(shown.error).toBeUndefined();
    await expect(page.locator("[data-webmcp-highlight]")).toContainText("cancer vaccine teaches");
    const view = await callTool(page, "get_current_view");
    expect(view.title ?? "").toBeTruthy();
    // Heading text is what a reader sees: no permalink glyphs from the anchor link.
    expect(view.lesson.headings).toContainEqual({ id: "vaccines", text: "Vaccines" });
    expect(view.visibleHeading.text).not.toMatch(/#/);
  });
});
