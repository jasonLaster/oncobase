import { describe, expect, test } from "bun:test";

import { buildTaggedPageTree } from "./tag-page-groups";

describe("buildTaggedPageTree", () => {
  test("builds a nested tree from page parent paths", () => {
    expect(
      buildTaggedPageTree([
        { slug: "sources/meeting-notes/serova", title: "Serova call" },
        { slug: "sources/papers/serova-paper", title: "Serova paper" },
        { slug: "sources/meeting-notes/follow-up", title: "Follow-up" },
      ]),
    ).toEqual({
      name: "",
      path: "",
      pages: [],
      children: [
        {
          name: "sources",
          path: "sources",
          pages: [],
          children: [
            {
              name: "meeting-notes",
              path: "sources/meeting-notes",
              children: [],
              pages: [
                { slug: "sources/meeting-notes/follow-up", title: "Follow-up" },
                { slug: "sources/meeting-notes/serova", title: "Serova call" },
              ],
            },
            {
              name: "papers",
              path: "sources/papers",
              children: [],
              pages: [{ slug: "sources/papers/serova-paper", title: "Serova paper" }],
            },
          ],
        },
      ],
    });
  });

  test("keeps root-level pages on the root node", () => {
    expect(buildTaggedPageTree([{ slug: "overview", title: "Overview" }])).toEqual({
      name: "",
      path: "",
      children: [],
      pages: [{ slug: "overview", title: "Overview" }],
    });
  });
});
