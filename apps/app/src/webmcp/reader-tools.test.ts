import { describe, expect, test } from "bun:test";
import type { FileNode } from "@oncobase/wiki-content";
import { anchorForLine, createReaderTools, linkedSlugs, type ReaderToolDeps } from "./reader-tools";
import type { PageContentRow, PageIndexRow } from "../types";

const page = (slug: string, title: string, tags: string[] = [], sensitive = false): PageIndexRow => ({
  slug, title, tagsJson: JSON.stringify(tags), description: null, contentHash: null, sensitive, size: 0,
});

const pages = [
  page("index", "Home"),
  page("treatment/chemo", "Chemotherapy", ["treatment", "drugs"]),
  page("treatment/surgery", "Surgery", ["treatment"]),
  page("private/labs", "Lab results", ["labs"], true),
];

const tree: FileNode[] = [
  { name: "index", slug: "index", type: "file" },
  { name: "treatment", slug: "treatment", type: "directory", children: [
    { name: "chemo", slug: "treatment/chemo", type: "file" },
    { name: "surgery", slug: "treatment/surgery", type: "file" },
  ] },
];

const body = (slug: string, content: string): PageContentRow => ({
  slug, title: slug, content, tagsJson: "[]", contentHash: null, expectedContentHash: null, sensitive: false,
  size: content.length, fetchedAt: 0, missingAt: null, staleAt: null, deletedAt: null, contentStatus: "fresh",
});

const chemo = "# Chemotherapy\n\nIntro.\n\n## Regimens\n\nAC-T is common. See [[surgery]].\n\n## Side effects\n\nNausea.";

function deps(overrides: Partial<ReaderToolDeps> = {}) {
  const navigations: string[] = [];
  const requests: string[] = [];
  const base: ReaderToolDeps = {
    scope: "session",
    signedIn: true,
    pages: () => pages,
    tree: () => tree,
    assets: () => [{ path: "treatment/chemo.pdf", kind: "pdf", contentHash: null, size: 10 }],
    cachedPage: (slug) => (slug === "treatment/chemo" ? body(slug, chemo) : null),
    recentSlugs: () => ["treatment/surgery", "missing"],
    allowPrivate: () => false,
    commentsEnabled: false,
    navigate: (href) => navigations.push(href),
    location: () => ({ pathname: "/treatment/chemo", search: "", hash: "" }),
    fetch: async (input) => {
      requests.push(input);
      if (input.startsWith("/api/search")) {
        return Response.json({ results: [
          { slug: "treatment/chemo", title: "Chemotherapy", matches: [{ lineNumber: 7, lineContent: "AC-T is common." }] },
          { slug: "private/labs", title: "Lab results", matches: [{ lineNumber: 2, lineContent: "secret value" }] },
          { slug: "index", title: "Home", matches: [{ lineNumber: 1, lineContent: "AC-T" }] },
        ] });
      }
      if (input.startsWith("/api/page-copy")) return new Response("# Lab results\n\nsecret value");
      return new Response("", { status: 404 });
    },
    contentRoot: () => null,
    pageReady: () => false,
    ...overrides,
  };
  const tools = Object.fromEntries(createReaderTools(base).map((tool) => [tool.name, tool]));
  const run = (name: string, input: Record<string, unknown> = {}) => tools[name]!.execute(input, {}) as Promise<Record<string, any>>;
  return { tools, run, navigations, requests };
}

describe("reader WebMCP tools", () => {
  test("anchorForLine maps a line to the nearest heading id", () => {
    expect(anchorForLine(chemo, 7)).toBe("regimens");
    expect(anchorForLine(chemo, 1)).toBe("chemotherapy");
    expect(anchorForLine(chemo, 11)).toBe("side-effects");
  });

  test("linkedSlugs resolves wikilinks and relative links", () => {
    expect(linkedSlugs("See [[surgery]] and [x](/treatment/chemo#a) and [[Home|start]].", pages)).toEqual([
      "treatment/surgery", "index", "treatment/chemo",
    ]);
  });

  test("text search filters by folder, deep-links matches and withholds private snippets", async () => {
    const { run } = deps();
    const all = await run("search_wiki", { query: "AC-T" });
    expect(all.results).toHaveLength(3);
    expect(all.results[0].matches[0].section_href).toBe("/treatment/chemo#regimens");
    const privateHit = all.results.find((hit: { slug: string }) => hit.slug === "private/labs");
    expect(privateHit.private).toBe(true);
    expect(JSON.stringify(privateHit)).not.toContain("secret");

    const scoped = await run("search_wiki", { query: "AC-T", folder: "treatment" });
    expect(scoped.results.map((hit: { slug: string }) => hit.slug)).toEqual(["treatment/chemo"]);
    const tagged = await run("search_wiki", { query: "AC-T", tag: "Drugs" });
    expect(tagged.results.map((hit: { slug: string }) => hit.slug)).toEqual(["treatment/chemo"]);
  });

  test("read_page reads a section from the local cache with outline and links", async () => {
    const { run, requests } = deps();
    const result = await run("read_page", { slug: "treatment/chemo", section: "Regimens" });
    expect(result.content).toBe("## Regimens\n\nAC-T is common. See [[surgery]].");
    expect(result.outline.map((item: { id: string }) => item.id)).toEqual(["chemotherapy", "regimens", "side-effects"]);
    expect(result.linked_pages).toEqual([{ slug: "treatment/surgery", title: "Surgery" }]);
    expect(result.source_files).toEqual([{ path: "treatment/chemo.pdf", kind: "pdf", bytes: 10 }]);
    expect(requests).toEqual([]);
  });

  test("private pages are withheld until the reader allows agents", async () => {
    const denied = await deps().run("read_page", { slug: "private/labs" });
    expect(denied.content).toBeNull();
    expect(JSON.stringify(denied)).not.toContain("secret");

    const allowed = await deps({ allowPrivate: () => true }).run("read_page", { slug: "private/labs" });
    expect(allowed.content).toContain("secret value");
  });

  test("unknown slugs return a helpful error instead of throwing", async () => {
    const result = await deps().run("read_page", { slug: "nope" });
    expect(result.error).toContain("search_wiki");
  });

  test("browse, tags and recents come from the local manifest", async () => {
    const { run } = deps();
    expect((await run("browse")).entries[1]).toEqual({ type: "folder", name: "treatment", folder: "treatment", items: 2 });
    expect((await run("browse", { folder: "treatment" })).entries.map((entry: { slug: string }) => entry.slug)).toEqual([
      "treatment/chemo", "treatment/surgery",
    ]);
    expect((await run("list_tags")).tags[0]).toEqual({ tag: "treatment", pages: 2 });
    expect((await run("get_pages_by_tag", { tag: "#drugs" })).pages[0].slug).toBe("treatment/chemo");
    expect((await run("recent_pages")).pages.map((entry: { slug: string }) => entry.slug)).toEqual(["treatment/surgery"]);
  });

  test("navigation tools route through the reader", async () => {
    const { run, navigations } = deps();
    await run("open_search", { query: "AC-T", mode: "text" });
    await run("open_tag", { tag: "drugs" });
    await run("ask_wiki_chat", { question: "What is AC-T?" });
    expect(navigations).toEqual(["/search?q=AC-T&tab=text", "/tags/drugs", "/chat?q=What+is+AC-T%3F"]);
    expect((await run("open_tag", { tag: "unknown" })).error).toBeDefined();
  });

  test("comments are only offered when enabled", () => {
    expect(deps().tools.list_comments).toBeUndefined();
    expect(deps({ commentsEnabled: true }).tools.list_comments?.annotations?.untrustedContentHint).toBe(true);
  });
});
