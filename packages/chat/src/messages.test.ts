import { describe, expect, test } from "bun:test";
import {
  extractSourcePages,
  extractSourcesFromToolOutputs,
  getChatToolInfo,
} from "./components/messages";

describe("message helpers", () => {
  test("normalizes static and dynamic tool parts", () => {
    expect(
      getChatToolInfo({
        type: "tool-fetch_data",
        state: "output-available",
        input: { query: "alpha" },
        output: { ok: true },
      })
    ).toEqual({
      toolName: "fetch_data",
      state: "output-available",
      input: { query: "alpha" },
      output: { ok: true },
    });

    expect(
      getChatToolInfo({
        type: "dynamic-tool",
        toolName: "lookup",
        state: "input-streaming",
      })
    ).toEqual({
      toolName: "lookup",
      state: "input-streaming",
      input: undefined,
      output: undefined,
    });
  });

  test("extracts generic sources from tool outputs", () => {
    const parts = [
      {
        type: "tool-lookup",
        state: "output-available",
        output: [
          { id: "a", title: "Alpha", href: "/alpha" },
          { id: "a", title: "Alpha duplicate", href: "/alpha" },
          { title: "Beta", url: "https://example.com/beta" },
        ],
      },
      {
        type: "tool-fetch_related",
        state: "output-available",
        output: {
          sources: [{ id: "g", title: "Gamma", href: "/gamma" }],
        },
      },
    ] as never;

    expect(extractSourcesFromToolOutputs(parts)).toEqual([
      { id: "a", title: "Alpha", href: "/alpha" },
      {
        id: "https://example.com/beta",
        title: "Beta",
        href: "https://example.com/beta",
      },
      { id: "g", title: "Gamma", href: "/gamma" },
    ]);
    expect(extractSourcePages(parts)).toEqual(extractSourcesFromToolOutputs(parts));
  });
});
