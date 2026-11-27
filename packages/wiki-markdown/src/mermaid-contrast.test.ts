import { describe, expect, test } from "bun:test";
import {
  DARK_LABEL_TEXT,
  LIGHT_LABEL_TEXT,
  labelColorFix,
  parseCssColor,
} from "./mermaid-contrast.ts";
import { renderWikiMarkdownHtml } from "./server.ts";

describe("mermaid label contrast", () => {
  test("parses hex, short hex, rgb and rgba colours", () => {
    expect(parseCssColor("#FFD6D6")).toEqual([255, 214, 214]);
    expect(parseCssColor("#fff")).toEqual([255, 255, 255]);
    expect(parseCssColor("rgb(30, 41, 59)")).toEqual([30, 41, 59]);
    expect(parseCssColor("rgba(0, 0, 0, 0.1)")).toBeNull();
    expect(parseCssColor("var(--fg)")).toBeNull();
  });

  test("flips light theme text on a pastel author fill and keeps readable authored colours", () => {
    expect(labelColorFix("#ffd6d6", "#e2e8f0")).toBe(DARK_LABEL_TEXT);
    expect(labelColorFix("#1e3a5f", "#1a1a2e")).toBe(LIGHT_LABEL_TEXT);
    expect(labelColorFix("#dbeafe", "#111827")).toBeNull();
    expect(labelColorFix("var(--_node-fill)", "#e2e8f0")).toBeNull();
  });

  test("server-rendered dark diagrams give pastel author fills dark labels", () => {
    const html = renderWikiMarkdownHtml(
      [
        "```mermaid",
        "flowchart TD",
        '  A["Plain"] --> B{"Progression?"}',
        '  A --> C["Current"]',
        "  style B fill:#ffd6d6,stroke:#cc0000",
        "  classDef current fill:#dbeafe,stroke:#2563eb,color:#111827",
        "  class C current",
        "```",
      ].join("\n"),
    );
    const [, light, dark] = html.split('<div class="mermaid-diagram');
    const labelFill = (svg: string, id: string) =>
      svg.match(new RegExp(`data-id="${id}"[\\s\\S]*?<text[^>]*fill="([^"]+)"`))?.[1];

    expect(labelFill(dark, "B")).toBe(DARK_LABEL_TEXT);
    expect(labelFill(dark, "C")).toBe("#111827");
    expect(labelFill(dark, "A")).toBe("var(--_text)");
    expect(labelFill(light, "B")).toBe("var(--_text)");
  });

  test("CSS-variable themes give authored fills a fixed readable label colour", () => {
    const html = renderWikiMarkdownHtml(
      "```mermaid\nflowchart TD\n  A[\"Plain\"] --> B[\"Pink\"]\n  style B fill:#ffd6d6\n```",
      undefined,
      { mermaidOptions: { bg: "var(--card)", fg: "var(--foreground)", transparent: true } },
    );
    const labelFill = (id: string) =>
      html.match(new RegExp(`data-id="${id}"[\\s\\S]*?<text[^>]*fill="([^"]+)"`))?.[1];
    expect(labelFill("B")).toBe(DARK_LABEL_TEXT);
    expect(labelFill("A")).toBe("var(--_text)");
  });
});
