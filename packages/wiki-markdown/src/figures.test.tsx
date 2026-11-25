import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { figureTableData, parseFigureSpec, parseSimpleYaml } from "./figure-spec.ts";
import { WikiFigureRendered } from "./figures.tsx";
import { WikiMarkdown } from "./index.tsx";
import { renderWikiMarkdownHtml } from "./server.ts";

const verticalBarsYaml = `
type: bars
title: When recurrences happen (share of all)
orientation: vertical
unit: "%"
data:
  - { label: Year 1, value: 41, tone: cost }
  - { label: Year 2, value: 32, tone: cost }
  - { label: Year 3, value: 13 }
  - { label: Years 4–10, value: 14 }
bracket: { from: 0, to: 1, label: 73% in the first 2 years, tone: cost }
caption: Share of all recurrences by year after surgery.
`;

const horizontalBarsYaml = `
type: bars
orientation: horizontal
data:
  - { label: Prevented, value: 5, display: "5", tone: benefit }
  - { label: Found while still local, value: 2.5, display: "2.5", tone: benefit-soft }
  - { label: Later spread elsewhere, value: 1, display: "~1", tone: cost }
  - { label: End in death, value: 1, display: "~1", tone: ink }
caption: Fate of 5 prevented nipple recurrences.
`;

const divergingYaml = `
type: diverging
leftLabel: "Cost of 4 weeks' delay"
rightLabel: Possible gain from removal
leftTone: cost
rightTone: benefit
data:
  - label: Alive
    left: 0.8
    leftText: "about −1"
    right: 1
    rightText: "+1 if cancer is there"
    expected: 0.25
    expectedText: "about +¼ at a 25% chance"
  - label: Free of recurrence
    left: 1
    leftText: "about −1"
    right: 3
    rightText: "+3 if cancer is there"
    expected: 0.75
    expectedText: "about +¾ at a 25% chance"
caption: Points per 100 women.
`;

const iconArrayYaml = `
type: icon-array
data:
  - { label: "Keep: ~6 in 100", count: 6, of: 100, tone: cost }
  - { label: "Remove: ~1 in 100", count: 1, of: 100, tone: benefit }
caption: Each dot is one woman.
`;

const timelineYaml = `
type: timeline
title: Estimated drug start
data:
  - { date: Nov 30, label: Optional surgery, tone: cost }
  - { date: Dec 7, label: Radiation (keep), tone: benefit }
  - { date: Jan 4, label: Next drug (keep), tone: benefit }
  - { date: Feb 1, label: Next drug (remove), tone: cost }
caption: Holiday scheduling could shift dates.
`;

describe("figure YAML parser", () => {
  test("parses comments, flow objects, block mappings, and quoted strings", () => {
    const parsed = parseSimpleYaml(`
# leading comment
type: bars # inline comment
title: "A: quoted, title # not a comment"
nested:
  a: 1.5
  b: true
list:
  - { label: "One, two", value: 10 }
  - label: Three
    value: 20
`);
    expect(parsed).toEqual({
      type: "bars",
      title: "A: quoted, title # not a comment",
      nested: { a: 1.5, b: true },
      list: [
        { label: "One, two", value: 10 },
        { label: "Three", value: 20 },
      ],
    });
  });

  test("rejects unknown figure types and missing data", () => {
    expect(parseFigureSpec("type: pie\ndata:\n  - { label: A, value: 1 }").ok).toBe(false);
    expect(parseFigureSpec("type: bars").ok).toBe(false);
  });
});

describe("figure SVG renderers", () => {
  for (const [name, yaml, expectedSnippets] of [
    [
      "vertical bars with bracket",
      verticalBarsYaml,
      [
        'data-figure-type="bars"',
        'role="img"',
        "When recurrences happen (share of all)",
        "41%",
        "73% in the first 2 years",
        "var(--figure-cost",
        "Share of all recurrences by year after surgery.",
      ],
    ],
    [
      "horizontal funnel bars",
      horizontalBarsYaml,
      [
        'data-figure-type="bars"',
        "Prevented",
        "Found while still local",
        "~1",
        "var(--figure-benefit-soft",
        "var(--figure-ink",
      ],
    ],
    [
      "diverging balance",
      divergingYaml,
      [
        'data-figure-type="diverging"',
        "Cost of 4 weeks&#x27; delay",
        "Possible gain from removal",
        "+3 if cancer is there",
        "about +¾ at a 25% chance",
        "var(--figure-cost",
        "var(--figure-benefit",
      ],
    ],
    [
      "icon-array",
      iconArrayYaml,
      [
        'data-figure-type="icon-array"',
        "Keep: ~6 in 100",
        "Remove: ~1 in 100",
        "<circle",
        "var(--figure-neutral-soft",
      ],
    ],
    [
      "timeline",
      timelineYaml,
      [
        'data-figure-type="timeline"',
        "Nov 30",
        "Jan 4",
        "Feb 1",
        "Optional surgery",
        "<circle",
      ],
    ],
  ] as const) {
    test(`renders deterministic themed SVG and accessible table for ${name}`, () => {
      const parsed = parseFigureSpec(yaml);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const html = renderToStaticMarkup(createElement(WikiFigureRendered, { spec: parsed.spec }));
      const second = renderToStaticMarkup(createElement(WikiFigureRendered, { spec: parsed.spec }));
      expect(html).toBe(second);
      expect(html).toContain("<svg");
      expect(html).toContain("wiki-sr-only");
      for (const snippet of expectedSnippets) {
        expect(html).toContain(snippet);
      }

      const table = figureTableData(parsed.spec);
      expect(table.headers.length).toBeGreaterThanOrEqual(2);
      expect(table.rows.length).toBeGreaterThanOrEqual(2);
    });
  }

  test("server renders SVG inline without wrapping the accessible table as smart-table, while React SSR emits the fallback table", () => {
    const md = `\`\`\`figure\n${verticalBarsYaml.trim()}\n\`\`\`\n`;
    const serverHtml = renderWikiMarkdownHtml(md);
    expect(serverHtml).toContain("<svg");
    expect(serverHtml).toContain('data-figure-type="bars"');
    expect(serverHtml).not.toContain("data-smart-table");
    expect(serverHtml).toContain("73% in the first 2 years");

    const reactHtml = renderToStaticMarkup(createElement(WikiMarkdown, { content: md }));
    expect(reactHtml).toContain("wiki-data-figure--fallback");
    expect(reactHtml).toContain("<table");
    expect(reactHtml).toContain("Year 1");
    expect(reactHtml).toContain("41%");
    expect(reactHtml).toContain("Share of all recurrences by year after surgery.");
  });

  test("renders an error fallback figure for malformed YAML without crashing", () => {
    const md = "```figure\ntype: unknown\n```\n";
    const serverHtml = renderWikiMarkdownHtml(md);
    const reactHtml = renderToStaticMarkup(createElement(WikiMarkdown, { content: md }));
    for (const html of [serverHtml, reactHtml]) {
      expect(html).toContain("wiki-data-figure--error");
      expect(html).toContain("Figure could not be rendered");
    }
  });
});

describe("figure ranges, empty sides, fixed scale and width-aware layout", () => {
  const divergingRangeYaml = `
type: diverging
leftLabel: Lowers OS
rightLabel: Raises OS
data:
  - { label: Capecitabine dropped, left: 8, right: 0 }
  - { label: LVI absent, left: 0, right: 11, rightHigh: 17 }
  - { label: 7-week wait, left: 1.6, leftHigh: 3.2, right: 0 }
`;

  test("empty diverging sides draw no bar or ±0 label, and ranges show central and bound", () => {
    const parsed = parseFigureSpec(divergingRangeYaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const html = renderToStaticMarkup(createElement(WikiFigureRendered, { spec: parsed.spec }));
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
    expect(svg).not.toContain(">+0<");
    expect(svg).not.toContain(">−0<");
    expect(svg).toContain("+11 (to +17)");
    expect(svg).toContain("−1.6 (to −3.2)");
    // Accessible table marks empty sides with an em dash.
    expect(figureTableData(parsed.spec).rows[0]).toEqual(["Capecitabine dropped", "−8", "—"]);
  });

  test("bars honor a fixed max so 0–100% means the full axis", () => {
    const parsed = parseFigureSpec(`
type: bars
orientation: horizontal
unit: "%"
max: 100
data:
  - { label: MRI, value: 95 }
  - { label: Ultrasound, value: 38 }
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.spec.type !== "bars") return;
    expect(parsed.spec.max).toBe(100);
  });

  test("lays out at the container width so type is not scaled down on phones", async () => {
    const { buildFigureSvgNode } = await import("./figure-svg.ts");
    const parsed = parseFigureSpec(divergingRangeYaml);
    if (!parsed.ok) throw new Error(parsed.error);
    const narrow = buildFigureSvgNode(parsed.spec, { width: 344 });
    expect(String(narrow.attrs?.viewBox)).toMatch(/^0 0 344 /);
    const natural = buildFigureSvgNode(parsed.spec);
    expect(String(natural.attrs?.viewBox)).toMatch(/^0 0 640 /);
  });
});
