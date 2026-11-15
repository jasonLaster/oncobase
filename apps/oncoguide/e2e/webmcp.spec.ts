import { expect, test, type Page } from "@playwright/test";

// WebMCP (document.modelContext) is an origin-trial API; stub it so the real
// registration and tool code run in any browser.
async function installModelContextStub(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, { execute: (input: unknown, options: unknown) => unknown }>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string; execute: (input: unknown, options: unknown) => unknown }, options: { signal?: AbortSignal } = {}) {
          if (tools.has(tool.name)) throw new DOMException(`Duplicate tool ${tool.name}`, "InvalidStateError");
          tools.set(tool.name, tool);
          options.signal?.addEventListener("abort", () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); });
          return Promise.resolve();
        },
      },
    });
    (window as unknown as { __webmcp: unknown }).__webmcp = {
      names: () => [...tools.keys()].sort(),
      call: async (name: string, input: unknown = {}) =>
        JSON.parse(JSON.stringify(await tools.get(name)!.execute(input, { signal: new AbortController().signal }))),
    };
  });
}

type Result = Record<string, any>;
const call = (page: Page, name: string, input: Record<string, unknown> = {}) =>
  page.evaluate(([tool, args]) => (window as unknown as { __webmcp: { call: (n: string, i: unknown) => Promise<Result> } }).__webmcp.call(tool, args), [name, input] as const);
const names = (page: Page) => page.evaluate(() => (window as unknown as { __webmcp: { names: () => string[] } }).__webmcp.names());

test("an in-browser agent can search, read, open and highlight lessons", async ({ page }) => {
  await installModelContextStub(page);
  await page.goto("/");
  await expect.poll(() => names(page)).toEqual([
    "ask_tutor", "get_current_view", "lesson_sections", "list_lessons", "open_page", "read_section", "search_education", "show_passage",
  ]);

  const lessons = await call(page, "list_lessons");
  expect(lessons.lessons.length).toBeGreaterThan(50);

  const search = await call(page, "search_education", { query: "autophagy" });
  const hit = search.results[0];
  expect(hit).toMatchObject({ id: expect.any(String), href: expect.stringContaining("/education/") });

  const section = await call(page, "read_section", { section_id: hit.id });
  expect(section.text.length).toBeGreaterThan(50);

  const opened = await call(page, "open_page", { section_id: hit.id });
  expect(opened.error).toBeUndefined();
  await expect(page.getByTestId("education-article")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(new URL(hit.href, page.url()).pathname);

  const view = await call(page, "get_current_view");
  expect(view.lesson?.slug ?? view.slug).toBeTruthy();

  const quote = section.text.split(/(?<=\.)\s/).find((sentence: string) => sentence.length > 40)!.slice(0, 80);
  const shown = await call(page, "show_passage", { quote, section_id: hit.id });
  expect(shown.error).toBeUndefined();
  await expect(page.locator("[data-webmcp-highlight]")).toBeVisible();
});
