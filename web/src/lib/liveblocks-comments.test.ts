import { describe, expect, test } from "bun:test";
import type { ThreadData } from "@liveblocks/client";
import {
  buildCommentListItems,
  createThreadMetadata,
  getCommentPlainText,
} from "./liveblocks-comments";

function thread(
  id: string,
  createdAt: string,
  metadata: Record<string, unknown> = {}
) {
  return {
    id,
    createdAt: new Date(createdAt),
    metadata,
  } as ThreadData;
}

describe("liveblocks comment helpers", () => {
  test("builds anchored list items with draft selection in document order", () => {
    const draftAnchor = {
      start: 50,
      end: 60,
      quote: "draft",
      prefix: "",
      suffix: "",
    };

    const items = buildCommentListItems(
      [
        thread("late", "2026-01-01T00:00:00.000Z", {
          anchorStart: 90,
          anchorEnd: 95,
          anchorQuote: "late",
          anchorPrefix: "",
          anchorSuffix: "",
        }),
        thread("page-level", "2026-01-02T00:00:00.000Z"),
        thread("early", "2026-01-03T00:00:00.000Z", {
          anchorStart: 10,
          anchorEnd: 15,
          anchorQuote: "early",
          anchorPrefix: "",
          anchorSuffix: "",
        }),
      ],
      draftAnchor
    );

    expect(
      items.map((item) =>
        item.type === "thread" ? item.thread.id : "draft-selection"
      )
    ).toEqual(["early", "draft-selection", "late", "page-level"]);
  });

  test("stores selection metadata with document identity", () => {
    expect(
      createThreadMetadata({
        documentSlug: "about/About",
        documentTitle: "About",
        anchor: {
          start: 3,
          end: 12,
          quote: "selection",
          prefix: "pre",
          suffix: "post",
        },
      })
    ).toEqual({
      documentSlug: "about/About",
      documentTitle: "About",
      anchorStart: 3,
      anchorEnd: 12,
      anchorQuote: "selection",
      anchorPrefix: "pre",
      anchorSuffix: "post",
    });
  });

  test("extracts plain text from comment bodies", () => {
    expect(
      getCommentPlainText({
        version: 1,
        content: [
          {
            type: "paragraph",
            children: [{ text: "Hello " }, { text: "comments" }],
          },
        ],
      })
    ).toBe("Hello comments");
  });
});
