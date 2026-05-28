import { describe, expect, test } from "bun:test";
import {
  ChatRequestSchema,
  compactChatToolResult,
  generateChatSearchPatterns,
} from "./chat-route";

describe("ChatRequestSchema", () => {
  test("accepts a minimal valid body", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty messages", () => {
    const result = ChatRequestSchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  test("rejects non-array messages", () => {
    const result = ChatRequestSchema.safeParse({ messages: "hi" });
    expect(result.success).toBe(false);
  });

  test("preserves conversationId", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
      conversationId: "conv_abc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationId).toBe("conv_abc");
    }
  });
});

describe("compactChatToolResult", () => {
  test("drops content from read_page-shaped objects", () => {
    const compacted = compactChatToolResult({
      slug: "wiki/x",
      title: "X",
      content: "8KB of text",
      linked_pages: [],
    }) as Record<string, unknown>;
    expect(compacted.slug).toBe("wiki/x");
    expect(compacted.title).toBe("X");
    expect(compacted).not.toHaveProperty("content");
    expect(compacted.linked_pages).toEqual([]);
  });

  test("flattens search-result arrays to citation fields", () => {
    const compacted = compactChatToolResult([
      { slug: "a", title: "A", excerpt: "drop me", tags: ["x"] },
      { slug: "b", title: "B", href: "/b", anchor: "#sec" },
    ]) as Array<Record<string, unknown>>;
    expect(compacted).toEqual([
      { slug: "a", title: "A", href: undefined, anchor: undefined },
      { slug: "b", title: "B", href: "/b", anchor: "#sec" },
    ]);
  });

  test("returns scalars unchanged", () => {
    expect(compactChatToolResult("ok")).toBe("ok");
    expect(compactChatToolResult(42)).toBe(42);
    expect(compactChatToolResult(null)).toBe(null);
  });
});

describe("generateChatSearchPatterns", () => {
  test("returns the cleaned query as the first pattern", () => {
    const patterns = generateChatSearchPatterns("peptide vaccines for TNBC");
    expect(patterns[0]).toBe("peptide vaccines");
  });

  test("expands medical abbreviations when present", () => {
    const patterns = generateChatSearchPatterns("status of ctdna testing");
    expect(patterns).toContain("circulating tumor DNA");
  });

  test("never returns more than 5 patterns", () => {
    const patterns = generateChatSearchPatterns(
      "ctdna pcr tmb hrd mrd rcb pembro brca",
    );
    expect(patterns.length).toBeLessThanOrEqual(5);
  });

  test("returns empty for blank input", () => {
    expect(generateChatSearchPatterns("")).toEqual([]);
    expect(generateChatSearchPatterns("   ")).toEqual([]);
  });

  test("adds the longest specific terms when query has 3+ significant words", () => {
    const patterns = generateChatSearchPatterns(
      "pembrolizumab toxicity cardiotoxicity prevention",
    );
    expect(patterns).toContain("cardiotoxicity");
  });
});
