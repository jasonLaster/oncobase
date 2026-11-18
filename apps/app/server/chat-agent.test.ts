import { describe, expect, test } from "bun:test";
import { WIKI_CHAT_AUTOMATION_HEADER, WIKI_CHAT_MODELS, wikiChatAudience, wikiChatFallbackModels, wikiChatModel } from "@oncobase/wiki-content/chat-route";
import {
  WIKI_CHAT_MAX_STEPS,
  createWikiChatTools,
  grepSearchablePages,
  wikiChatPrepareStep,
  wikiChatRunSettings,
  type WikiChatDocuments,
} from "./chat-agent";

const page = (slug: string, content: string) => ({ slug, title: slug, lines: content.split("\n") });

describe("grep_wiki matching", () => {
  const pages = [
    page("wiki/treatment/plan", "# Plan\n## Maintenance\nDrugzumab 10 mg daily.\nDRUGZUMAB start pending."),
    page("sources/meeting-notes/day-2", "## Planning meeting\nDiscussed drugzumab."),
    page("wiki/other", "Nothing relevant (a+b)."),
  ];

  test("ranks by match count and gives each line's section anchor", () => {
    const result = grepSearchablePages(pages, "drugzumab");
    expect(result.total_pages).toBe(2);
    expect(result.results[0]).toMatchObject({ slug: "wiki/treatment/plan", match_count: 2 });
    expect(result.results[0]!.matches[0]).toEqual({ line: 3, text: "Drugzumab 10 mg daily.", anchor: "maintenance" });
    expect(result.results[1]!.matches[0]!.anchor).toBe("planning-meeting");
  });

  test("matches literally and filters by folder", () => {
    expect(grepSearchablePages(pages, "(a+b)").results.map((hit) => hit.slug)).toEqual(["wiki/other"]);
    expect(grepSearchablePages(pages, "drugzumab", "sources/meeting-notes/").results.map((hit) => hit.slug))
      .toEqual(["sources/meeting-notes/day-2"]);
  });
});

describe("wiki chat tools", () => {
  const documents: WikiChatDocuments = {
    search: async () => [],
    getBySlug: async () => null,
    list: async () => [],
    getByTag: async () => [],
    listTags: async () => [],
    vectorSearch: async () => [],
  };

  test("an empty search tells the model to try other words", async () => {
    const tools = createWikiChatTools({ documents, piiPatterns: [], embedQuery: async () => null });
    expect(await tools.search_wiki.execute({ query: "nothing" })).toMatchObject({ results: [], hint: expect.stringContaining("different words") });
  });

  test("grep_wiki falls back to search_wiki when the corpus is not ready", async () => {
    const tools = createWikiChatTools({ documents: { ...documents, searchablePages: async () => null }, piiPatterns: [], embedQuery: async () => null });
    expect(await tools.grep_wiki.execute({ text: "drugzumab" })).toEqual({ error: expect.stringContaining("search_wiki") });
  });

  test("search_wiki interleaves patterns so expansions are not crowded out", async () => {
    const rows = (prefix: string) => Array.from({ length: 6 }, (_, index) => ({ slug: `${prefix}/${index}`, title: `${prefix} ${index}`, tags: [] }));
    const tools = createWikiChatTools({
      documents: { ...documents, search: async ({ query }) => rows(query.includes("pathologic") ? "expanded" : "plain") },
      piiPatterns: [],
      embedQuery: async () => null,
    });
    const result = await tools.search_wiki.execute({ query: "pCR odds" }) as Array<{ slug: string }>;
    expect(result.slice(0, 4).some((row) => row.slug.startsWith("expanded/"))).toBe(true);
  });
});

describe("wiki chat run settings", () => {
  test("the last step must answer instead of calling tools", () => {
    const messages = [{ role: "user" as const, content: "q" }];
    expect(wikiChatPrepareStep({ stepNumber: 0, messages })).not.toHaveProperty("toolChoice");
    expect(wikiChatPrepareStep({ stepNumber: WIKI_CHAT_MAX_STEPS - 1, messages })).toMatchObject({ toolChoice: "none", activeTools: [] });
  });

  test("each step marks the newest message for Anthropic prompt caching", () => {
    const messages = [
      { role: "user" as const, content: "q" },
      { role: "assistant" as const, content: "a", providerOptions: { openai: { x: 1 } } },
    ];
    const prepared = wikiChatPrepareStep({ stepNumber: 1, messages }).messages;
    expect(prepared[0]).toEqual(messages[0]);
    expect(prepared[1]!.providerOptions).toEqual({ openai: { x: 1 }, anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(messages[1]!.providerOptions).toEqual({ openai: { x: 1 } });
  });

  test("every attempt is restricted to zero-retention, no-training providers", () => {
    for (const audience of ["person", "automation"] as const) {
      expect(wikiChatRunSettings({ env: {}, audience }).providerOptions.gateway)
        .toMatchObject({ zeroDataRetention: true, disallowPromptTraining: true });
    }
  });

  test("people on production get the strong model; everything else the cheap one", () => {
    const headers = (value?: string) => new Headers(value ? { [WIKI_CHAT_AUTOMATION_HEADER]: value } : {});
    expect(wikiChatAudience({ VERCEL_ENV: "production" }, headers())).toBe("person");
    expect(wikiChatAudience({ VERCEL_ENV: "production" }, headers("1"))).toBe("automation");
    expect(wikiChatAudience({ VERCEL_ENV: "preview" }, headers())).toBe("automation");
    expect(wikiChatAudience({}, headers())).toBe("automation");
    expect(wikiChatModel({}, "person")).toBe(WIKI_CHAT_MODELS.person);
    expect(wikiChatModel({}, "automation")).toBe(WIKI_CHAT_MODELS.automation);
    expect(WIKI_CHAT_MODELS.automation).toStartWith("deepseek/");
  });

  test("each tier can be overridden and is never its own fallback", () => {
    expect(wikiChatModel({ WIKI_CHAT_MODEL: " openai/gpt-5.6-luna " }, "person")).toBe("openai/gpt-5.6-luna");
    expect(wikiChatModel({ WIKI_CHAT_AUTOMATION_MODEL: "zai/glm-5.3-flash" }, "automation")).toBe("zai/glm-5.3-flash");
    expect(wikiChatFallbackModels({ WIKI_CHAT_MODEL: "openai/gpt-5.6-luna" }, "person")).not.toContain("openai/gpt-5.6-luna");
    expect(wikiChatFallbackModels({ WIKI_CHAT_FALLBACK_MODELS: "" }, "person")).toEqual([]);
    expect(wikiChatFallbackModels({ WIKI_CHAT_AUTOMATION_FALLBACK_MODELS: "a/b, c/d" }, "automation")).toEqual(["a/b", "c/d"]);
  });

  test("pinning a model disables fallbacks", () => {
    const settings = wikiChatRunSettings({ env: {}, audience: "person", model: "zai/glm-5.3-flash" });
    expect(settings.model).toBe("zai/glm-5.3-flash");
    expect(settings.providerOptions.gateway.models).toEqual([]);
  });
});
