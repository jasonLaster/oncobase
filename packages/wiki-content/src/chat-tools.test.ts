import { describe, expect, test } from "bun:test";
import {
  CHAT_UNAVAILABLE_CONTENT,
  findInChatPage,
  readChatPageFromDocuments,
  type ChatPageDocumentsGateway,
} from "./chat-tools.ts";

function createDocumentsGateway(
  docs: Array<{
    slug: string;
    title: string;
    content: string;
    tags: string[];
    sensitive?: boolean;
  }>,
): ChatPageDocumentsGateway {
  return {
    async getBySlug({ slug, includeSensitive }) {
      const doc = docs.find((item) => item.slug === slug);
      if (!doc || (doc.sensitive && !includeSensitive)) return null;
      return doc;
    },
  };
}

describe("chat page tools", () => {
  test("returns unavailable metadata for sensitive pages", async () => {
    const result = await readChatPageFromDocuments(
      createDocumentsGateway([
        {
          slug: "private/notes",
          title: "Diana private notes",
          content: "secret",
          tags: ["private"],
          sensitive: true,
        },
      ]),
      "private/notes#follow-up",
    );

    expect(result).toEqual({
      slug: "private/notes",
      title: "Diana private notes",
      href: "/private/notes#follow-up",
      anchor: "follow-up",
      tags: ["private"],
      content: CHAT_UNAVAILABLE_CONTENT,
      linked_pages: [],
      unavailable: true,
      sensitive: true,
    });
  });

  test("redacts content and resolves linked pages", async () => {
    const result = await readChatPageFromDocuments(
      createDocumentsGateway([
        {
          slug: "wiki/plan",
          title: "Diana treatment plan",
          content: "Discuss [[wiki/labs#cbc|labs]] with Diana Laster.",
          tags: ["plan"],
        },
        {
          slug: "wiki/labs",
          title: "Diana labs",
          content: "labs",
          tags: ["labs"],
        },
      ]),
      "wiki/plan",
    );

    expect(result).toMatchObject({
      slug: "wiki/plan",
      title: "Diana treatment plan",
      content: "Discuss [[wiki/labs#cbc|labs]] with the patient.",
      linked_pages: [
        {
          slug: "wiki/labs",
          title: "Diana labs",
          href: "/wiki/labs#cbc",
          anchor: "cbc",
        },
      ],
    });
  });
});

describe("long pages", () => {
  const intro = "Intro line about the plan.\n".repeat(40);
  const surgery = "## Surgery details\n" + "The first procedure finished on schedule.\n".repeat(40);
  const followUp = "## Follow-up\n" + "Drugzumab reviewed at the planning meeting.\n".repeat(40);
  const long = `# Plan\n${intro}${surgery}${followUp}`;
  const documents = createDocumentsGateway([{ slug: "wiki/plan", title: "Plan", content: long, tags: [] }]);

  test("returns a window with an outline and says it is partial", async () => {
    const result = await readChatPageFromDocuments(documents, "wiki/plan", { maxChars: 1500 });
    if (!("slug" in result)) throw new Error("expected a page");
    expect(result.truncated).toBe(true);
    // Redaction normalizes the trailing newline, so compare loosely.
    expect(Math.abs(result.total_chars! - long.length)).toBeLessThanOrEqual(1);
    expect(result.content.length).toBeLessThanOrEqual(1500);
    // The window stops at a line break rather than mid-sentence.
    expect(result.content.endsWith(".")).toBe(true);
    expect(result.next_offset).toBe(result.content.length);
    expect(result.sections?.map((section) => section.anchor)).toEqual(["plan", "surgery-details", "follow-up"]);
  });

  test("starts at the section an anchor names, and continues from next_offset", async () => {
    const atSection = await readChatPageFromDocuments(documents, "wiki/plan#follow-up", { maxChars: 600 });
    if (!("slug" in atSection)) throw new Error("expected a page");
    expect(atSection.content.startsWith("## Follow-up")).toBe(true);
    expect(atSection.href).toBe("/wiki/plan#follow-up");

    const next = await readChatPageFromDocuments(documents, "wiki/plan", { maxChars: 600, offset: atSection.next_offset });
    if (!("slug" in next)) throw new Error("expected a page");
    expect(next.offset).toBe(atSection.next_offset);
    expect(next.content).toContain("Drugzumab");
  });

  test("matches Obsidian-style heading anchors and reports a missing one", async () => {
    const obsidian = await readChatPageFromDocuments(documents, "wiki/plan#Surgery details", { maxChars: 600 });
    if (!("slug" in obsidian)) throw new Error("expected a page");
    expect(obsidian.content.startsWith("## Surgery details")).toBe(true);

    const missing = await readChatPageFromDocuments(documents, "wiki/plan#radiation", { maxChars: 600 });
    if (!("slug" in missing)) throw new Error("expected a page");
    expect(missing.offset).toBe(0);
    expect(missing.note).toContain("#radiation");
  });

  test("short pages come back whole without window fields", async () => {
    const result = await readChatPageFromDocuments(
      createDocumentsGateway([{ slug: "a", title: "A", content: "short", tags: [] }]),
      "a",
    );
    expect(result).toEqual({ slug: "a", title: "A", href: "/a", anchor: undefined, tags: [], content: "short", linked_pages: [] });
  });

  test("find_in_page returns separated passages with their section", async () => {
    const result = await findInChatPage(documents, "wiki/plan", "drugzumab planning meeting");
    if (!("matches" in result)) throw new Error("expected matches");
    expect(result.total_matches).toBeGreaterThan(1);
    expect(result.matches[0]!.anchor).toBe("follow-up");
    expect(result.matches[0]!.excerpt.toLowerCase()).toContain("drugzumab");
  });

  test("find_in_page redacts and respects sensitive pages", async () => {
    const gateway = createDocumentsGateway([
      { slug: "p", title: "P", content: "Called Diana Laster about drugzumab.", tags: [] },
      { slug: "s", title: "S", content: "drugzumab", tags: [], sensitive: true },
    ]);
    const visible = await findInChatPage(gateway, "p", "drugzumab");
    if (!("matches" in visible)) throw new Error("expected matches");
    expect(visible.matches[0]!.excerpt).not.toContain("Laster");
    const hidden = await findInChatPage(gateway, "s", "drugzumab");
    expect(hidden).toMatchObject({ content: CHAT_UNAVAILABLE_CONTENT, unavailable: true });
  });
});
