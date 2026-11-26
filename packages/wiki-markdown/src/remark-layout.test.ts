import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdown } from "./index.tsx";
import { toPortableMarkdown } from "./portable.ts";
import { isolateDirectiveLines } from "./remark-layout.ts";
import { renderWikiMarkdownHtml } from "./server.ts";

function renderBoth(markdown: string) {
  return {
    react: renderToStaticMarkup(createElement(WikiMarkdown, { content: markdown })),
    server: renderWikiMarkdownHtml(markdown),
  };
}

describe("remarkLayout: Obsidian callouts", () => {
  test("maps callout types to tones and preserves inline formatting in title and body", () => {
    const md = [
      "> [!question] The **one** question to ask first",
      '> "When could radiation and the next drug **actually** start?"',
      "",
      "> [!warning] Watch for",
      "> Any new lump lasting more than 2 weeks.",
      "",
      "> [!summary] On the numbers, it is a tie.",
      "> Radiation treats the area either way.",
      "",
      "> [!quote] Why the row shows +2",
      "> Delay gives about 1 point back.",
      "",
      "> [!note]",
      "> Default title falls back to type name.",
    ].join("\n");

    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toContain('class="wiki-callout wiki-callout--question wiki-callout--tone-benefit"');
      expect(html).toContain('data-callout="question"');
      expect(html).toContain('data-callout-tone="benefit"');
      expect(html).toContain('<div class="wiki-callout__title">The <strong>one</strong> question to ask first</div>');
      expect(html).toContain("<strong>actually</strong>");

      expect(html).toContain('class="wiki-callout wiki-callout--warning wiki-callout--tone-cost"');
      expect(html).toContain('class="wiki-callout wiki-callout--summary wiki-callout--tone-lead"');
      expect(html).toContain('class="wiki-callout wiki-callout--quote wiki-callout--tone-quote"');
      expect(html).toContain('class="wiki-callout wiki-callout--note wiki-callout--tone-tint"');
      expect(html).toContain('<div class="wiki-callout__title">Note</div>');
    }
  });

  test("renders foldable callouts (- / +) as <details> with <summary>", () => {
    const md = [
      "> [!note]- Closed details",
      "> Hidden by default.",
      "",
      "> [!tip]+ Open details",
      "> Visible by default.",
    ].join("\n");

    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toMatch(/<details class="wiki-callout wiki-callout--note wiki-callout--tone-tint"[^>]*><summary class="wiki-callout__title">Closed details<\/summary>/);
      expect(html).toMatch(/<details class="wiki-callout wiki-callout--tip wiki-callout--tone-benefit"[^>]*\bopen(?:="")?[^>]*><summary class="wiki-callout__title">Open details<\/summary>/);
    }
  });

  test("leaves ordinary blockquotes untouched", () => {
    const { react, server } = renderBoth("> A regular quotation.");
    for (const html of [react, server]) {
      expect(html).toContain("<blockquote>");
      expect(html).not.toContain("wiki-callout");
    }
  });
});

describe("remarkLayout: columns", () => {
  test("splits on the first heading level and applies optional column tones", () => {
    const md = [
      ':::columns{tone="benefit cost"}',
      "### The case for removing it",
      "Prevents local recurrence.",
      "### The case for leaving it in",
      "Avoids delaying the next drug.",
      ":::",
    ].join("\n");

    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toContain('class="wiki-columns wiki-columns--2"');
      expect(html).toContain('data-columns="2"');
      expect(html).toContain('class="wiki-column wiki-column--benefit"');
      expect(html).toContain('class="wiki-column wiki-column--cost"');
      expect(html).toContain("The case for removing it");
      expect(html).toContain("The case for leaving it in");
      expect(html).not.toContain(":::columns");
    }
  });

  test("splits headingless callout pairs into one column per callout", () => {
    const md = [
      ":::columns",
      "> [!note] First read: Dr. Jackson, Nov 16",
      "> Gut was to remove it.",
      "",
      "> [!question] Updated read: tumor board, Nov 23",
      "> Not likely a positive margin.",
      ":::",
    ].join("\n");

    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toContain('class="wiki-columns wiki-columns--2"');
      expect(html.match(/class="wiki-column"/g)?.length).toBe(2);
      expect(html).toContain("First read: Dr. Jackson, Nov 16");
      expect(html).toContain("Updated read: tumor board, Nov 23");
    }
  });

  test("isolates directive lines outside fences without altering fenced examples", () => {
    const md = [
      "Paragraph right before",
      ":::columns",
      "### A",
      "Text A",
      "### B",
      "Text B",
      ":::",
      "Paragraph right after",
      "",
      "```md",
      "before",
      ":::columns",
      "inside fence",
      ":::",
      "```",
    ].join("\n");

    const isolated = isolateDirectiveLines(md);
    expect(isolated).toContain("Paragraph right before\n\n:::columns\n\n### A");
    expect(isolated).toContain("Text B\n\n:::\n\nParagraph right after");
    expect(isolated).toContain("```md\nbefore\n:::columns\ninside fence\n:::\n```");

    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toContain('class="wiki-columns wiki-columns--2"');
      expect(html).toContain("<pre><code");
      expect(html).toContain(":::columns");
    }
  });

  test("does not swallow text when :::columns is unclosed", () => {
    const md = ":::columns\n\n### Only one\n\nStill visible.";
    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toContain("Still visible.");
      expect(html).not.toContain('class="wiki-columns');
    }
  });
});

describe("remarkLayout: explicit column separators", () => {
  test("--- wins over the callout rule, so no stray rule renders beside a callout", () => {
    const md = [":::columns", "> [!note] Box", "> body", "", "Paragraph under the box.", "", "---", "", "Right column.", ":::"].join("\n");
    const html = renderWikiMarkdownHtml(md);
    expect(html).toContain('<div class="wiki-columns wiki-columns--2"');
    expect(html).not.toContain("<hr");
  });
});

describe("remarkLayout: columns inside callouts", () => {
  test("splits `> :::columns` inside a foldable callout on bold lead paragraphs", () => {
    const md = [
      "> [!question]- Four questions",
      "> :::columns",
      "> **Pathology & surgery**",
      "> - one",
      ">",
      "> **Oncology**",
      "> - two",
      "> :::",
    ].join("\n");
    const html = renderWikiMarkdownHtml(md);
    expect(html).toContain('<div class="wiki-columns wiki-columns--2"');
    expect(html).not.toContain(":::");
  });
});

describe("remarkLayout: page breaks", () => {
  test("converts <!-- page-break --> to a print page-break marker", () => {
    const md = "Page one.\n\n<!-- page-break -->\n\nPage two.";
    const { react, server } = renderBoth(md);
    for (const html of [react, server]) {
      expect(html).toContain('<div class="wiki-page-break" aria-hidden="true"></div>');
      expect(html).toContain("Page one.");
      expect(html).toContain("Page two.");
    }
  });
});

describe("toPortableMarkdown for layout directives", () => {
  test("degrades callouts, columns, figures, and page breaks cleanly while preserving fenced examples", () => {
    const md = [
      "> [!summary] Short answer",
      "> The two choices are close.",
      "",
      ':::columns{tone="benefit cost"}',
      "### Remove it",
      "One option.",
      "### Leave it in",
      "Another option.",
      ":::",
      "",
      "<!-- page-break -->",
      "",
      "```figure",
      "type: bars",
      "title: Share by year",
      "orientation: vertical",
      'unit: "%"',
      "data:",
      "  - { label: Year 1, value: 41, tone: cost }",
      "  - { label: Year 2, value: 32, tone: cost }",
      "bracket: { from: 0, to: 1, label: 73% in the first 2 years, tone: cost }",
      "caption: Share of recurrences by year.",
      "```",
      "",
      "```md",
      ":::columns",
      "> [!note] Fenced example",
      ":::",
      "```",
    ].join("\n");

    const portable = toPortableMarkdown(md);
    expect(portable).toContain("> **Short answer**\n> The two choices are close.");
    expect(portable).not.toContain("[!summary]");
    expect(portable).not.toContain(":::columns{");
    expect(portable).not.toContain("page-break");
    expect(portable).toContain("### Remove it\nOne option.");
    expect(portable).toContain("**Figure: Share by year.** Share of recurrences by year.");
    expect(portable).toContain("- Year 1: 41%");
    expect(portable).toContain("- Year 2: 32%");
    expect(portable).toContain("- 73% in the first 2 years");
    // Fenced markdown example survives verbatim.
    expect(portable).toContain("```md\n:::columns\n> [!note] Fenced example\n:::\n```");
  });

  test("preserves :::redact blocks untouched when stripping :::columns", () => {
    const md = [
      ":::redact[Hidden]",
      "Secret.",
      ":::",
      "",
      ":::columns",
      "### A",
      "Public A",
      ":::",
    ].join("\n");

    const portable = toPortableMarkdown(md);
    expect(portable).toContain(":::redact[Hidden]\nSecret.\n:::");
    expect(portable).not.toContain(":::columns");
    expect(portable).toContain("### A\nPublic A");
  });
});
