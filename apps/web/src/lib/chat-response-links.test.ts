import { describe, expect, test } from "bun:test";
import { isInternalChatResponseHref, resolveChatResponseHref } from "./chat-response-links";

describe("resolveChatResponseHref", () => {
  test("roots bare wiki slugs so chat links do not resolve under /chat", () => {
    expect(resolveChatResponseHref("wiki/treatment/treatment-plan")).toBe(
      "/wiki/treatment/treatment-plan"
    );
  });

  test("preserves already absolute app paths", () => {
    expect(resolveChatResponseHref("/wiki/treatment/treatment-plan")).toBe(
      "/wiki/treatment/treatment-plan"
    );
  });

  test("preserves anchors and external URLs", () => {
    expect(resolveChatResponseHref("#references")).toBe("#references");
    expect(resolveChatResponseHref("https://example.com/page")).toBe(
      "https://example.com/page"
    );
    expect(resolveChatResponseHref("mailto:test@example.com")).toBe(
      "mailto:test@example.com"
    );
  });

  test("classifies only root-relative app paths as internal", () => {
    expect(isInternalChatResponseHref("/wiki/example")).toBe(true);
    expect(isInternalChatResponseHref("//example.com/wiki")).toBe(false);
    expect(isInternalChatResponseHref("https://example.com/wiki")).toBe(false);
  });
});
