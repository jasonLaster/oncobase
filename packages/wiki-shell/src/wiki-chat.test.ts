import { describe, expect, test } from "bun:test";
import { extractWikiChatSources } from "./wiki-chat.tsx";

describe("wiki chat tooling", () => {
  test("extracts wiki chat sources from read and search tools", () => {
    const parts = [
      {
        type: "tool-read_page",
        state: "output-available",
        input: { slug: "wiki/people/medical-team" },
        output: {
          slug: "wiki/people/medical-team",
          title: "Medical Team",
        },
      },
      {
        type: "tool-read_page",
        state: "output-available",
        input: { slug: "wiki/missing" },
        output: {
          slug: "wiki/missing",
          title: "Missing",
          error: "Not found",
        },
      },
      {
        type: "tool-search_wiki",
        state: "output-available",
        input: { query: "insurance" },
        output: [
          { slug: "wiki/logistics/insurance", title: "Insurance" },
          { href: "/sources/meeting-notes/03-19", title: "Stanford notes" },
          { slug: "wiki/logistics/insurance", title: "Duplicate" },
        ],
      },
    ] as never;

    expect(extractWikiChatSources(parts)).toEqual([
      {
        id: "/wiki/people/medical-team",
        title: "Medical Team",
        href: "/wiki/people/medical-team",
      },
      {
        id: "/wiki/logistics/insurance",
        title: "Insurance",
        href: "/wiki/logistics/insurance",
      },
      {
        id: "/sources/meeting-notes/03-19",
        title: "Stanford notes",
        href: "/sources/meeting-notes/03-19",
      },
    ]);
  });
});
