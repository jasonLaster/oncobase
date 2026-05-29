import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render-markdown";
import { resolveWikilinks } from "./wikilinks";

describe("resolveWikilinks", () => {
  test("resolves escaped aliases without keeping the escape in the target", () => {
    expect(resolveWikilinks("[[wiki/treatment/escalation-ladder\\|ladder]]")).toBe(
      "[ladder](/wiki/treatment/escalation-ladder)"
    );
  });

  test("preserves anchor fragments in escaped aliases", () => {
    expect(resolveWikilinks("[[about/Terminology#ctdna\\|ctDNA]]")).toBe(
      "[ctDNA](/about/Terminology#ctdna)"
    );
  });

  test("strips mdx extensions from targets and labels", () => {
    expect(resolveWikilinks("[[about/Home.mdx]]")).toBe("[Home](/about/Home)");
  });

  test("renders escaped aliases inside table cells as one table cell link", () => {
    const resolved = resolveWikilinks(
      "| Signal | Source |\n|---|---|\n| ctDNA | [[wiki/diagnostics/ctdna-mrd\\|ctDNA/MRD]] |"
    );
    const html = renderMarkdown(resolved, "wiki/example");

    expect(html).toContain('href="/wiki/diagnostics/ctdna-mrd"');
    expect(html).toContain(">ctDNA/MRD</a>");
    expect(html).not.toContain("ctdna-mrd\\");
  });
});
