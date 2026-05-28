import { describe, expect, test } from "bun:test";
import {
  buildCommentListItems,
  createThreadMetadata,
  getCommentPlainText,
  getThreadAnchor,
  isSelectionAnchor,
  sortThreads,
  type SelectionAnchor,
} from "./threads";

function thread(start: number, createdAt: string) {
  return {
    createdAt: new Date(createdAt),
    metadata: createThreadMetadata({
      anchor: {
        start,
        end: start + 4,
        quote: "text",
        prefix: "",
        suffix: "",
      },
      documentSlug: "wiki/page",
      documentTitle: "Wiki Page",
    }),
  } as never;
}

describe("comment thread helpers", () => {
  test("validates and extracts selection anchors", () => {
    const anchor: SelectionAnchor = {
      start: 2,
      end: 6,
      quote: "TNBC",
      prefix: "about ",
      suffix: " care",
    };

    expect(isSelectionAnchor(anchor)).toBe(true);
    expect(isSelectionAnchor({ ...anchor, start: "2" })).toBe(false);
    expect(getThreadAnchor(thread(2, "2026-01-01T00:00:00Z"))).toEqual({
      start: 2,
      end: 6,
      quote: "text",
      prefix: "",
      suffix: "",
    });
  });

  test("sorts anchored threads by document position", () => {
    const later = thread(20, "2026-01-01T00:00:00Z");
    const earlier = thread(5, "2026-01-02T00:00:00Z");

    expect(sortThreads([later, earlier])).toEqual([earlier, later]);
  });

  test("places draft selections among existing threads", () => {
    const items = buildCommentListItems([thread(20, "2026-01-01T00:00:00Z")], {
      start: 5,
      end: 9,
      quote: "text",
      prefix: "",
      suffix: "",
    });

    expect(items.map((item) => item.type)).toEqual(["draft-selection", "thread"]);
  });

  test("extracts plain text from Liveblocks comment bodies", () => {
    expect(
      getCommentPlainText({
        content: [
          { children: [{ text: "Hello" }, { text: " " }] },
          { children: [{ text: "world" }] },
        ],
      }),
    ).toBe("Hello world");
  });
});
