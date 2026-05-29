import { describe, expect, it } from "bun:test";
import { slugsFromGitOutput } from "./changed-slugs";

// Regression: an earlier version of the backfill script passed
// `${vaultRel}/**.md` as the git pathspec, which silently dropped
// nested-directory paths in the output. The current implementation
// passes a directory pathspec and filters to markdown files in JS, so the
// parser must correctly handle multiple directory depths.

describe("slugsFromGitOutput", () => {
  it("strips the vault prefix and markdown suffix", () => {
    const raw = [
      "obsidian/about/Log.md",
      "obsidian/about/Home.mdx",
      "obsidian/wiki/education/index.md",
    ].join("\n");
    const slugs = slugsFromGitOutput(raw, "obsidian");
    expect([...slugs].sort()).toEqual([
      "about/Home",
      "about/Log",
      "wiki/education/index",
    ]);
  });

  it("handles deeply nested paths", () => {
    const raw = [
      "obsidian/wiki/education/designing-a-vaccine/02-hla-and-antigen-presentation.md",
      "obsidian/sources/research/papers/ablation-immunotherapy/tselikas-2026.md",
    ].join("\n");
    const slugs = slugsFromGitOutput(raw, "obsidian");
    expect(slugs.size).toBe(2);
    expect(slugs.has("wiki/education/designing-a-vaccine/02-hla-and-antigen-presentation")).toBe(true);
    expect(slugs.has("sources/research/papers/ablation-immunotherapy/tselikas-2026")).toBe(true);
  });

  it("ignores non-markdown files and blank pretty-format separators", () => {
    const raw = [
      "obsidian/wiki/education/images/foo.png",
      "",
      "",
      "obsidian/wiki/education/index.md",
      "obsidian/about/Log.md",
    ].join("\n");
    const slugs = slugsFromGitOutput(raw, "obsidian");
    expect([...slugs].sort()).toEqual([
      "about/Log",
      "wiki/education/index",
    ]);
  });

  it("dedupes when the same slug appears in multiple commits", () => {
    const raw = [
      "obsidian/about/Log.md",
      "",
      "obsidian/about/Log.md",
      "obsidian/about/Log.md",
    ].join("\n");
    const slugs = slugsFromGitOutput(raw, "obsidian");
    expect(slugs.size).toBe(1);
  });

  it("accepts a vaultRel with a trailing slash", () => {
    const raw = "obsidian/about/Log.md";
    const slugs = slugsFromGitOutput(raw, "obsidian/");
    expect([...slugs]).toEqual(["about/Log"]);
  });

  it("leaves paths outside the vault prefix intact", () => {
    // git log output should always be inside vaultRel (we pass it
    // as a pathspec) but defensively the parser must not corrupt
    // unexpected paths into wrong slugs.
    const raw = ["apps/web/scripts/foo.md", "obsidian/index.md"].join("\n");
    const slugs = slugsFromGitOutput(raw, "obsidian");
    expect(slugs.has("index")).toBe(true);
    expect(slugs.has("apps/web/scripts/foo")).toBe(true);
  });
});
