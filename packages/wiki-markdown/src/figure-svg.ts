import {
  figureTableData,
  formatBarValue,
  type BarsFigureSpec,
  type DivergingFigureSpec,
  type FigureSpec,
  type FigureTone,
  type IconArrayFigureSpec,
  type TimelineFigureSpec,
} from "./figure-spec.ts";

export type SvgChild = SvgElementNode | string;

export type SvgElementNode = {
  tag: string;
  attrs?: Record<string, string | number | undefined>;
  children?: SvgChild[];
};

const INK = "var(--figure-ink, #1c1c1a)";
const INK_MUTED = "var(--figure-ink-muted, #52514e)";
const RULE = "var(--figure-rule, #e4e2dc)";
const NEUTRAL_SOFT = "var(--figure-neutral-soft, #e4e2dc)";
const SURFACE = "var(--background, #ffffff)";

function toneFill(tone: FigureTone | undefined): string {
  switch (tone) {
    case "benefit":
      return "var(--figure-benefit, #2a78d6)";
    case "benefit-soft":
      return "var(--figure-benefit-soft, #a9c9f0)";
    case "cost":
      return "var(--figure-cost, #eb6834)";
    case "ink":
      return INK;
    default:
      return "var(--figure-neutral, #b9b7ae)";
  }
}

function toneSoftFill(tone: FigureTone | undefined): string {
  switch (tone) {
    case "benefit":
      return "var(--figure-benefit-soft, #a9c9f0)";
    case "cost":
      return "var(--figure-cost-soft, #f6b699)";
    default:
      return NEUTRAL_SOFT;
  }
}

function toneText(tone: FigureTone | undefined): string {
  switch (tone) {
    case "benefit":
    case "benefit-soft":
      return "var(--figure-benefit-text, #1f5fae)";
    case "cost":
      return "var(--figure-cost-text, #b9481c)";
    case "ink":
      return INK;
    default:
      return INK_MUTED;
  }
}

function wrapLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function el(
  tag: string,
  attrs?: Record<string, string | number | undefined>,
  children?: SvgChild[],
): SvgElementNode {
  return { tag, attrs, children };
}

function buildHorizontalBars(spec: BarsFigureSpec, ariaLabel: string): SvgElementNode {
  const width = 360;
  const maxVal = Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  const maxLabelChars = Math.max(...spec.data.map((d) => d.label.length), 8);
  const labelWidth = Math.min(168, Math.max(96, maxLabelChars * 6 + 12));
  const valueAllowance = 46;
  const barMaxWidth = Math.max(80, width - labelWidth - valueAllowance - 12);
  const titleOffset = spec.title ? 20 : 4;
  const rowStep = 28;
  const height = titleOffset + spec.data.length * rowStep + 4;

  const children: SvgChild[] = [];
  if (spec.title) {
    children.push(el("text", { x: 0, y: 13, "font-size": 10.5, "font-weight": 700, fill: INK }, [spec.title]));
  }
  spec.data.forEach((item, index) => {
    const y = titleOffset + index * rowStep;
    const barW = Math.max(4, (Math.abs(item.value) / maxVal) * barMaxWidth);
    const valueLabel = formatBarValue(item, spec.unit);
    children.push(
      el("g", undefined, [
        el("text", { x: labelWidth - 8, y: y + 15, "text-anchor": "end", "font-size": 10, fill: INK }, [item.label]),
        el("rect", { x: labelWidth, y: y + 2, width: barW, height: 18, rx: 4, fill: toneFill(item.tone ?? "benefit") }),
        el("text", { x: labelWidth + barW + 6, y: y + 15, "font-size": 10.5, "font-weight": 700, fill: INK }, [valueLabel]),
      ]),
    );
  });

  return el("svg", { class: "wiki-data-figure__svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel }, children);
}

function buildVerticalBars(spec: BarsFigureSpec, ariaLabel: string): SvgElementNode {
  const count = spec.data.length;
  const width = Math.max(320, count * 76 + 24);
  const padX = 14;
  const gap = 16;
  const barWidth = Math.min(58, (width - padX * 2 - gap * (count - 1)) / count);
  const totalBarsWidth = count * barWidth + (count - 1) * gap;
  const startX = (width - totalBarsWidth) / 2;
  const maxVal = Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  const titleOffset = spec.title ? 20 : 6;
  const maxBarHeight = 96;
  const baselineY = titleOffset + 18 + maxBarHeight;
  const hasBracket =
    spec.bracket &&
    spec.bracket.from >= 0 &&
    spec.bracket.to < count &&
    spec.bracket.to >= spec.bracket.from;
  const height = baselineY + (hasBracket ? 40 : 20);

  const children: SvgChild[] = [];
  if (spec.title) {
    children.push(el("text", { x: 0, y: 13, "font-size": 10.5, "font-weight": 700, fill: INK }, [spec.title]));
  }
  children.push(el("line", { x1: 0, y1: baselineY, x2: width, y2: baselineY, stroke: RULE, "stroke-width": 1 }));

  spec.data.forEach((item, index) => {
    const h = Math.max(4, (Math.abs(item.value) / maxVal) * maxBarHeight);
    const x = startX + index * (barWidth + gap);
    const fill = toneFill(item.tone ?? "neutral");
    const valueLabel = formatBarValue(item, spec.unit);
    const groupChildren: SvgChild[] = [
      el("rect", { x, y: baselineY - h, width: barWidth, height: h, rx: 4, fill }),
    ];
    if (h > 6) {
      groupChildren.push(el("rect", { x, y: baselineY - 4, width: barWidth, height: 4, fill }));
    }
    groupChildren.push(
      el("text", { x: x + barWidth / 2, y: baselineY - h - 5, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: INK }, [valueLabel]),
      el("text", { x: x + barWidth / 2, y: baselineY + 14, "text-anchor": "middle", "font-size": 9.5, fill: INK_MUTED }, [item.label]),
    );
    children.push(el("g", undefined, groupChildren));
  });

  if (hasBracket && spec.bracket) {
    const x1 = startX + spec.bracket.from * (barWidth + gap);
    const x2 = startX + spec.bracket.to * (barWidth + gap) + barWidth;
    children.push(
      el("g", undefined, [
        el("line", { x1, y1: baselineY + 21, x2, y2: baselineY + 21, stroke: toneFill(spec.bracket.tone ?? "cost"), "stroke-width": 1.6 }),
        el("text", { x: (x1 + x2) / 2, y: baselineY + 35, "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: toneText(spec.bracket.tone ?? "cost") }, [spec.bracket.label]),
      ]),
    );
  }

  return el("svg", { class: "wiki-data-figure__svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel }, children);
}

function buildDiverging(spec: DivergingFigureSpec, ariaLabel: string): SvgElementNode {
  const width = 640;
  const mid = 315;
  const maxLeft = Math.max(...spec.data.map((d) => d.left), 0.1);
  const maxRight = Math.max(...spec.data.map((d) => Math.max(d.right, d.expected ?? 0)), 0.1);
  const unit = Math.min(96 / maxLeft, 178 / maxRight);
  const hasExpected = spec.data.some((d) => d.expected !== undefined || d.expectedText);
  const rowStep = hasExpected ? 52 : 38;
  const titleOffset = spec.title ? 20 : 0;
  const headerY = titleOffset + 13;
  const topY = titleOffset + 26;
  const axisBottom = topY + spec.data.length * rowStep - (hasExpected ? 10 : 8);
  const height = axisBottom + 10;

  const leftFill = toneFill(spec.leftTone);
  const leftTextFill = toneText(spec.leftTone);
  const rightFill = toneFill(spec.rightTone);
  const rightSoftFill = toneSoftFill(spec.rightTone);
  const rightTextFill = toneText(spec.rightTone);

  const children: SvgChild[] = [];
  if (spec.title) {
    children.push(el("text", { x: 0, y: 13, "font-size": 11, "font-weight": 700, fill: INK }, [spec.title]));
  }
  children.push(
    el("text", { x: mid - 10, y: headerY, "text-anchor": "end", "font-size": 10.5, "font-weight": 700, fill: leftTextFill }, [`◀ ${spec.leftLabel}`]),
    el("text", { x: mid + 10, y: headerY, "text-anchor": "start", "font-size": 10.5, "font-weight": 700, fill: rightTextFill }, [`${spec.rightLabel} ▶`]),
  );

  spec.data.forEach((row, index) => {
    const y = topY + index * rowStep;
    const leftW = Math.max(4, row.left * unit);
    const rightW = Math.max(4, row.right * unit);
    const expW = row.expected !== undefined ? Math.max(4, row.expected * unit) : null;
    const groupChildren: SvgChild[] = [
      el("text", { x: 0, y: y + 15, "font-size": 11, "font-weight": 700, fill: INK }, [row.label]),
      el("rect", { x: mid - leftW, y, width: leftW, height: 22, rx: 4, fill: leftFill }),
      el("text", { x: mid - leftW - 6, y: y + 15, "text-anchor": "end", "font-size": 10.5, fill: INK }, [row.leftText ?? `−${row.left}`]),
      el("rect", { x: mid, y, width: rightW, height: 22, rx: 4, fill: expW !== null ? rightSoftFill : rightFill }),
    ];
    if (expW !== null) {
      groupChildren.push(el("rect", { x: mid, y, width: expW, height: 22, rx: 4, fill: rightFill }));
    }
    groupChildren.push(
      el("text", { x: mid + rightW + 6, y: y + 15, "font-size": 10.5, fill: INK }, [row.rightText ?? `+${row.right}`]),
    );
    if (row.expectedText) {
      groupChildren.push(
        el("text", { x: mid + (expW ?? 0) + 4, y: y + 36, "font-size": 9, "font-weight": 600, fill: rightTextFill }, [row.expectedText]),
      );
    }
    children.push(el("g", undefined, groupChildren));
  });

  children.push(el("line", { x1: mid, y1: titleOffset + 20, x2: mid, y2: axisBottom, stroke: INK, "stroke-width": 1.25 }));

  return el("svg", { class: "wiki-data-figure__svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel }, children);
}

function buildIconArray(spec: IconArrayFigureSpec, ariaLabel: string): SvgElementNode {
  const width = 328;
  const cols = 25;
  const dotStep = 8.4;
  const dotRadius = 3;
  const gridX = 112;
  const titleOffset = spec.title ? 20 : 4;

  let cursorY = titleOffset;
  const laidOut = spec.data.map((row) => {
    const dotRows = Math.max(1, Math.ceil(row.of / cols));
    const y0 = cursorY;
    cursorY += Math.max(3, dotRows) * dotStep + 12;
    return { ...row, y0 };
  });

  const children: SvgChild[] = [];
  if (spec.title) {
    children.push(el("text", { x: 0, y: 13, "font-size": 10.5, "font-weight": 700, fill: INK }, [spec.title]));
  }
  for (const row of laidOut) {
    const activeFill = toneFill(row.tone ?? "benefit");
    const total = Math.min(row.of, 400);
    const groupChildren: SvgChild[] = [
      el("text", { x: 0, y: row.y0 + 11, "font-size": 10, "font-weight": 700, fill: INK }, [row.label]),
    ];
    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const r = Math.floor(i / cols);
      groupChildren.push(
        el("circle", {
          cx: gridX + col * dotStep,
          cy: row.y0 + 4 + r * dotStep,
          r: dotRadius,
          fill: i < row.count ? activeFill : NEUTRAL_SOFT,
        }),
      );
    }
    children.push(el("g", undefined, groupChildren));
  }

  return el("svg", { class: "wiki-data-figure__svg", viewBox: `0 0 ${width} ${cursorY}`, role: "img", "aria-label": ariaLabel }, children);
}

function buildTimeline(spec: TimelineFigureSpec, ariaLabel: string): SvgElementNode {
  const count = spec.data.length;
  const width = Math.max(460, count * 130);
  const padX = 56;
  const titleOffset = spec.title ? 20 : 4;
  const railY = titleOffset + 28;
  const maxLines = Math.max(...spec.data.map((d) => wrapLines(d.label, 18).length), 1);
  const height = railY + 22 + maxLines * 13 + 6;
  const span = count > 1 ? (width - padX * 2) / (count - 1) : 0;

  const children: SvgChild[] = [];
  if (spec.title) {
    children.push(el("text", { x: 0, y: 13, "font-size": 10.5, "font-weight": 700, fill: INK }, [spec.title]));
  }
  children.push(
    el("line", { x1: padX, y1: railY, x2: count > 1 ? width - padX : padX, y2: railY, stroke: RULE, "stroke-width": 2 }),
  );
  spec.data.forEach((item, index) => {
    const cx = count > 1 ? padX + index * span : width / 2;
    const labelLines = wrapLines(item.label, 18);
    const groupChildren: SvgChild[] = [
      el("text", { x: cx, y: railY - 12, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: toneText(item.tone ?? "ink") }, [item.date]),
      el("circle", { cx, cy: railY, r: 6, fill: toneFill(item.tone ?? "benefit"), stroke: SURFACE, "stroke-width": 2 }),
    ];
    labelLines.forEach((line, lineIndex) => {
      groupChildren.push(
        el("text", { x: cx, y: railY + 20 + lineIndex * 13, "text-anchor": "middle", "font-size": 9.5, fill: INK_MUTED }, [line]),
      );
    });
    children.push(el("g", undefined, groupChildren));
  });

  return el("svg", { class: "wiki-data-figure__svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel }, children);
}

export function buildFigureSvgNode(spec: FigureSpec): SvgElementNode {
  const { ariaLabel } = figureTableData(spec);
  if (spec.type === "bars") {
    return spec.orientation === "vertical"
      ? buildVerticalBars(spec, ariaLabel)
      : buildHorizontalBars(spec, ariaLabel);
  }
  if (spec.type === "diverging") return buildDiverging(spec, ariaLabel);
  if (spec.type === "icon-array") return buildIconArray(spec, ariaLabel);
  return buildTimeline(spec, ariaLabel);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function serializeSvgNode(node: SvgChild): string {
  if (typeof node === "string") return escapeXml(node);
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .filter(([, val]) => val !== undefined)
        .map(([key, val]) => ` ${key}="${escapeXml(String(val))}"`)
        .join("")
    : "";
  const inner = node.children?.map(serializeSvgNode).join("") ?? "";
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/**
 * Pure-string static HTML renderer for ```figure blocks, shared by `server.ts`
 * without importing `react-dom/server` (which Next.js Turbopack rejects inside
 * Server Components).
 */
export function renderFigureStaticHtml(spec: FigureSpec): string {
  const svgHtml = serializeSvgNode(buildFigureSvgNode(spec));
  const captionHtml = spec.caption
    ? `<figcaption class="wiki-data-figure__caption">${escapeXml(spec.caption)}</figcaption>`
    : "";
  const { headers, rows } = figureTableData(spec);
  const thead = headers.map((h) => `<th scope="col">${escapeXml(h)}</th>`).join("");
  const tbody = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeXml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const tableHtml =
    `<table class="wiki-data-figure__table wiki-sr-only"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;

  return (
    `<figure class="wiki-data-figure" data-figure-type="${escapeXml(spec.type)}" data-figure-rendered="true" data-test-id="wiki-figure">` +
    svgHtml +
    captionHtml +
    tableHtml +
    `</figure>`
  );
}
