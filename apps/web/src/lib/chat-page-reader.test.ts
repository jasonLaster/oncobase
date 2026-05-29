import { describe, expect, test } from "bun:test";
import type { SiteData } from "./site-data";
import {
  CHAT_UNAVAILABLE_CONTENT,
  readChatPage,
} from "./chat-page-reader";

type TestDocument = NonNullable<
  Awaited<ReturnType<SiteData["documents"]["getBySlug"]>>
>;

function doc(overrides: Partial<TestDocument> & Pick<TestDocument, "slug">): TestDocument {
  return {
    title: overrides.slug,
    content: "",
    tags: [],
    sensitiveInclude: [],
    description: undefined,
    contentHash: undefined,
    hashFunctionVersion: undefined,
    sensitive: undefined,
    ...overrides,
  };
}

function siteDataWithDocs(
  getBySlug: SiteData["documents"]["getBySlug"],
): SiteData {
  return {
    documents: {
      getBySlug,
    },
  } as unknown as SiteData;
}

describe("readChatPage", () => {
  test("returns unavailable content when a page exists but is not public", async () => {
    const calls: Array<{ slug: string; includeSensitive?: boolean }> = [];
    const siteData = siteDataWithDocs(async (args) => {
      calls.push(args);
      if (!args.includeSensitive) return null;
      return doc({
        slug: "private/notes",
        title: "Private Notes",
        content: "do not leak this content",
        tags: ["sensitive"],
        sensitive: true,
      });
    });

    const result = await readChatPage(siteData, "private/notes");

    expect(result).toEqual({
      slug: "private/notes",
      title: "Private Notes",
      href: "/private/notes",
      anchor: undefined,
      tags: ["sensitive"],
      content: CHAT_UNAVAILABLE_CONTENT,
      linked_pages: [],
      unavailable: true,
      sensitive: true,
    });
    expect(calls).toEqual([
      { slug: "private/notes" },
      { slug: "private/notes", includeSensitive: true },
    ]);
  });

  test("resolves linked pages for public content", async () => {
    const siteData = siteDataWithDocs(async ({ slug }) => {
      if (slug === "wiki/plan") {
        return doc({
          slug,
          title: "Plan",
          content: "See [[sources/trial|Trial]] and [[private/notes]].",
        });
      }
      if (slug === "sources/trial") {
        return doc({
          slug,
          title: "Trial",
          content: "Trial content",
        });
      }
      return null;
    });

    const result = await readChatPage(siteData, "wiki/plan");

    expect(result).toMatchObject({
      slug: "wiki/plan",
      title: "Plan",
      href: "/wiki/plan",
      anchor: undefined,
      content: "See [[sources/trial|Trial]] and [[private/notes]].",
      linked_pages: [
        {
          slug: "sources/trial",
          title: "Trial",
          href: "/sources/trial",
          anchor: undefined,
        },
      ],
    });
  });

  test("normalizes mdx suffixes before lookup", async () => {
    const calls: string[] = [];
    const siteData = siteDataWithDocs(async ({ slug }) => {
      calls.push(slug);
      if (slug !== "wiki/index") return null;
      return doc({
        slug,
        title: "Index",
        content: "Index content",
      });
    });

    const result = await readChatPage(siteData, "wiki/index.mdx#overview");

    expect(calls).toEqual(["wiki/index"]);
    expect(result).toMatchObject({
      slug: "wiki/index",
      anchor: "overview",
      href: "/wiki/index#overview",
    });
  });
});
