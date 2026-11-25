import {
  divergingSideText,
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

/** Options for laying a figure out at a known container width (px). */
export type FigureLayoutOptions = {
  /**
   * Container width in CSS px. When given, the SVG is laid out at exactly this
   * width so it renders 1:1 and type keeps its size on phones and in columns.
   * Omitted (static/server render), each figure uses its natural width.
   */
  width?: number;
};

/** Type scale shared by every figure (px at 1:1). */
const FS = { title: 12.5, label: 12, value: 12, small: 10.5 } as const;

/** Rough text advance for the figure font (Helvetica/Inter-ish ≈ 0.56em). */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

function clampWidth(width: number | undefined, natural: number, min = 260): number {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return natural;
  return Math.max(min, Math.round(width));
}

function svgRoot(width: number, height: number, ariaLabel: string, children: SvgChild[]): SvgElementNode {
  return el(
    "svg",
    {
      class: "wiki-data-figure__svg",
      viewBox: `0 0 ${width} ${Math.ceil(height)}`,
      role: "img",
      "aria-label": ariaLabel,
    },
    children,
  );
}

function titleLines(title: string | undefined, width: number): string[] {
  if (!title) return [];
  return wrapLines(title, Math.max(16, Math.floor(width / (FS.title * 0.56))));
}

/** Extra vertical space taken by wrapped title lines beyond the first. */
function titleExtra(title: string | undefined, width: number): number {
  return Math.max(0, titleLines(title, width).length - 1) * 16;
}

function titleNode(title: string | undefined, width: number): SvgChild[] {
  return titleLines(title, width).map((line, index) =>
    el("text", { x: 0, y: 14 + index * 16, "font-size": FS.title, "font-weight": 700, fill: INK }, [line]),
  );
}

function buildHorizontalBars(spec: BarsFigureSpec, ariaLabel: string, opts: FigureLayoutOptions): SvgElementNode {
  const width = clampWidth(opts.width, 420);
  const scaleMax = spec.max ?? Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  const valueLabels = spec.data.map((d) => formatBarValue(d, spec.unit));
  const valueAllowance = Math.max(...valueLabels.map((v) => textWidth(v, FS.value)), 24) + 10;
  const longestLabel = Math.max(...spec.data.map((d) => textWidth(d.label, FS.label)), 40);
  // Narrow screens: put each label above its bar instead of in a column.
  const stacked = longestLabel + valueAllowance + 120 > width;
  const labelWidth = stacked ? 0 : Math.min(width * 0.42, longestLabel + 12);
  const barMaxWidth = Math.max(60, width - labelWidth - valueAllowance);
  const titleOffset = (spec.title ? 26 : 4) + titleExtra(spec.title, width);
  const rowStep = stacked ? 44 : 30;
  const height = titleOffset + spec.data.length * rowStep + 4;

  const children: SvgChild[] = [...titleNode(spec.title, width)];
  if (spec.max !== undefined) {
    // Faint full-scale track so a fixed 0–max axis is visible, not just claimed.
    spec.data.forEach((_, index) => {
      const y = titleOffset + index * rowStep + (stacked ? 18 : 0);
      children.push(el("rect", { x: labelWidth, y: y + 3, width: barMaxWidth, height: 18, rx: 4, fill: NEUTRAL_SOFT, opacity: 0.55 }));
    });
  }
  spec.data.forEach((item, index) => {
    const rowY = titleOffset + index * rowStep;
    const y = rowY + (stacked ? 18 : 0);
    const barW = Math.max(3, (Math.min(Math.abs(item.value), scaleMax) / scaleMax) * barMaxWidth);
    const label = stacked
      ? el("text", { x: 0, y: rowY + 13, "font-size": FS.label, fill: INK }, [item.label])
      : el("text", { x: labelWidth - 8, y: y + 16, "text-anchor": "end", "font-size": FS.label, fill: INK }, [item.label]);
    children.push(
      el("g", undefined, [
        label,
        el("rect", { x: labelWidth, y: y + 3, width: barW, height: 18, rx: 4, fill: toneFill(item.tone ?? "benefit") }),
        el("text", { x: labelWidth + barW + 6, y: y + 16, "font-size": FS.value, "font-weight": 700, fill: INK }, [valueLabels[index]!]),
      ]),
    );
  });

  return svgRoot(width, height, ariaLabel, children);
}

function buildVerticalBars(spec: BarsFigureSpec, ariaLabel: string, opts: FigureLayoutOptions): SvgElementNode {
  const count = spec.data.length;
  const width = clampWidth(opts.width, Math.max(340, count * 84 + 24));
  const padX = 8;
  const gap = Math.max(8, Math.min(18, width / (count * 6)));
  const barWidth = Math.min(64, (width - padX * 2 - gap * (count - 1)) / count);
  const totalBarsWidth = count * barWidth + (count - 1) * gap;
  const startX = (width - totalBarsWidth) / 2;
  const scaleMax = spec.max ?? Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  const titleOffset = (spec.title ? 26 : 6) + titleExtra(spec.title, width);
  const maxBarHeight = 110;
  const baselineY = titleOffset + 20 + maxBarHeight;
  const labelLines = spec.data.map((d) => wrapLines(d.label, Math.max(6, Math.floor((barWidth + gap) / (FS.small * 0.56)))));
  const maxLabelLines = Math.max(...labelLines.map((l) => l.length), 1);
  const labelBlock = 6 + maxLabelLines * 13;
  const hasBracket =
    spec.bracket &&
    spec.bracket.from >= 0 &&
    spec.bracket.to < count &&
    spec.bracket.to >= spec.bracket.from;
  const height = baselineY + labelBlock + (hasBracket ? 34 : 6);

  const children: SvgChild[] = [...titleNode(spec.title, width)];
  children.push(el("line", { x1: 0, y1: baselineY, x2: width, y2: baselineY, stroke: RULE, "stroke-width": 1 }));

  spec.data.forEach((item, index) => {
    const h = Math.max(3, (Math.min(Math.abs(item.value), scaleMax) / scaleMax) * maxBarHeight);
    const x = startX + index * (barWidth + gap);
    const fill = toneFill(item.tone ?? "neutral");
    const valueLabel = formatBarValue(item, spec.unit);
    const groupChildren: SvgChild[] = [];
    if (spec.max !== undefined) {
      groupChildren.push(el("rect", { x, y: baselineY - maxBarHeight, width: barWidth, height: maxBarHeight, rx: 4, fill: NEUTRAL_SOFT, opacity: 0.55 }));
    }
    groupChildren.push(el("rect", { x, y: baselineY - h, width: barWidth, height: h, rx: 4, fill }));
    if (h > 6) {
      groupChildren.push(el("rect", { x, y: baselineY - 4, width: barWidth, height: 4, fill }));
    }
    groupChildren.push(
      el("text", { x: x + barWidth / 2, y: baselineY - h - 6, "text-anchor": "middle", "font-size": FS.value, "font-weight": 700, fill: INK }, [valueLabel]),
    );
    labelLines[index]!.forEach((line, lineIndex) => {
      groupChildren.push(
        el("text", { x: x + barWidth / 2, y: baselineY + 16 + lineIndex * 13, "text-anchor": "middle", "font-size": FS.small, fill: INK_MUTED }, [line]),
      );
    });
    children.push(el("g", undefined, groupChildren));
  });

  if (hasBracket && spec.bracket) {
    const x1 = startX + spec.bracket.from * (barWidth + gap);
    const x2 = startX + spec.bracket.to * (barWidth + gap) + barWidth;
    const by = baselineY + labelBlock + 8;
    children.push(
      el("g", undefined, [
        el("line", { x1, y1: by, x2, y2: by, stroke: toneFill(spec.bracket.tone ?? "cost"), "stroke-width": 1.6 }),
        el("text", { x: (x1 + x2) / 2, y: by + 16, "text-anchor": "middle", "font-size": FS.small, "font-weight": 700, fill: toneText(spec.bracket.tone ?? "cost") }, [spec.bracket.label]),
      ]),
    );
  }

  return svgRoot(width, height, ariaLabel, children);
}

function buildDiverging(spec: DivergingFigureSpec, ariaLabel: string, opts: FigureLayoutOptions): SvgElementNode {
  const width = clampWidth(opts.width, 640, 280);
  const leftExtent = (d: (typeof spec.data)[number]) => Math.max(d.left, d.leftHigh ?? 0);
  const rightExtent = (d: (typeof spec.data)[number]) => Math.max(d.right, d.rightHigh ?? 0, d.expected ?? 0);
  const maxLeft = Math.max(...spec.data.map(leftExtent), 0);
  const maxRight = Math.max(...spec.data.map(rightExtent), 0);
  const leftTexts = spec.data.map((d) => (leftExtent(d) > 0 || d.leftText ? divergingSideText(d.left, d.leftText, d.leftHigh, "−") : ""));
  const rightTexts = spec.data.map((d) => (rightExtent(d) > 0 || d.rightText ? divergingSideText(d.right, d.rightText, d.rightHigh, "+") : ""));
  const leftTextW = Math.max(...leftTexts.map((t) => textWidth(t, FS.value)), 0) + (maxLeft > 0 ? 8 : 0);
  const rightTextW = Math.max(...rightTexts.map((t) => textWidth(t, FS.value)), 0) + (maxRight > 0 ? 8 : 0);
  const longestLabel = Math.max(...spec.data.map((d) => textWidth(d.label, FS.label)), 30);

  // Row labels sit in a left column when there is room, else above each bar.
  const stacked = width - (longestLabel + 14) - leftTextW - rightTextW < 220;
  const x0 = stacked ? 0 : Math.min(longestLabel + 14, width * 0.32);
  const span = Math.max(40, width - x0 - leftTextW - rightTextW);
  const total = maxLeft + maxRight || 1;
  const unit = span / total;
  const mid = x0 + leftTextW + maxLeft * unit;

  const hasExpected = spec.data.some((d) => d.expected !== undefined || d.expectedText);
  const barH = 20;
  const rowStep = (stacked ? 20 : 0) + barH + (hasExpected ? 22 : 12);
  const titleOffset = (spec.title ? 24 : 0) + titleExtra(spec.title, width);
  const headerY = titleOffset + 14;
  // Side headers: right-align the left one to the axis when it fits, else
  // start it at x=0; if the two would then collide, drop the right one a line.
  const leftHeader = `◀ ${spec.leftLabel}`;
  const rightHeader = `${spec.rightLabel} ▶`;
  const leftHeaderW = textWidth(leftHeader, FS.small);
  const leftHeaderFits = mid - 8 - leftHeaderW >= 0;
  const leftHeaderEnd = leftHeaderFits ? mid - 8 : leftHeaderW;
  const headersCollide = maxLeft > 0 && maxRight > 0 && leftHeaderEnd + 6 > mid + 8;
  const rightHeaderY = headersCollide ? headerY + 14 : headerY;
  const topY = titleOffset + 26 + (headersCollide ? 14 : 0);
  const axisBottom = topY + spec.data.length * rowStep - (hasExpected ? 14 : 8);
  const height = axisBottom + 6;

  const leftFill = toneFill(spec.leftTone);
  const leftSoftFill = toneSoftFill(spec.leftTone);
  const leftTextFill = toneText(spec.leftTone);
  const rightFill = toneFill(spec.rightTone);
  const rightSoftFill = toneSoftFill(spec.rightTone);
  const rightTextFill = toneText(spec.rightTone);

  const children: SvgChild[] = [...titleNode(spec.title, width)];
  if (maxLeft > 0) {
    children.push(
      el(
        "text",
        leftHeaderFits
          ? { x: mid - 8, y: headerY, "text-anchor": "end", "font-size": FS.small, "font-weight": 700, fill: leftTextFill }
          : { x: 0, y: headerY, "text-anchor": "start", "font-size": FS.small, "font-weight": 700, fill: leftTextFill },
        [leftHeader],
      ),
    );
  }
  if (maxRight > 0) {
    children.push(el("text", { x: mid + 8, y: rightHeaderY, "text-anchor": "start", "font-size": FS.small, "font-weight": 700, fill: rightTextFill }, [rightHeader]));
  }

  spec.data.forEach((row, index) => {
    const rowY = topY + index * rowStep;
    const y = rowY + (stacked ? 20 : 0);
    const groupChildren: SvgChild[] = [
      stacked
        ? el("text", { x: 0, y: rowY + 14, "font-size": FS.label, "font-weight": 700, fill: INK }, [row.label])
        : el("text", { x: 0, y: y + 15, "font-size": FS.label, "font-weight": 700, fill: INK }, [row.label]),
    ];

    // Left side: nothing at all when the side is empty.
    const leftEnd = leftExtent(row);
    if (leftEnd > 0) {
      if (row.leftHigh !== undefined && row.leftHigh > row.left) {
        groupChildren.push(el("rect", { x: mid - row.leftHigh * unit, y, width: row.leftHigh * unit, height: barH, rx: 4, fill: leftSoftFill }));
      }
      if (row.left > 0) {
        groupChildren.push(el("rect", { x: mid - row.left * unit, y, width: Math.max(2, row.left * unit), height: barH, rx: 4, fill: leftFill }));
      }
      groupChildren.push(
        el("text", { x: mid - leftEnd * unit - 6, y: y + 15, "text-anchor": "end", "font-size": FS.value, fill: INK }, [leftTexts[index]!]),
      );
    } else if (row.leftText) {
      groupChildren.push(el("text", { x: mid - 6, y: y + 15, "text-anchor": "end", "font-size": FS.value, fill: INK_MUTED }, [row.leftText]));
    }

    // Right side.
    const rightEnd = rightExtent(row);
    const expW = row.expected !== undefined ? Math.max(2, row.expected * unit) : null;
    if (rightEnd > 0) {
      if (row.rightHigh !== undefined && row.rightHigh > row.right) {
        groupChildren.push(el("rect", { x: mid, y, width: row.rightHigh * unit, height: barH, rx: 4, fill: rightSoftFill }));
      }
      if (row.right > 0) {
        groupChildren.push(
          el("rect", { x: mid, y, width: Math.max(2, row.right * unit), height: barH, rx: 4, fill: expW !== null ? rightSoftFill : rightFill }),
        );
      }
      if (expW !== null) {
        groupChildren.push(el("rect", { x: mid, y, width: expW, height: barH, rx: 4, fill: rightFill }));
      }
      groupChildren.push(el("text", { x: mid + rightEnd * unit + 6, y: y + 15, "font-size": FS.value, fill: INK }, [rightTexts[index]!]));
    } else if (row.rightText) {
      groupChildren.push(el("text", { x: mid + 6, y: y + 15, "font-size": FS.value, fill: INK_MUTED }, [row.rightText]));
    }
    if (row.expectedText) {
      groupChildren.push(
        el("text", { x: mid + (expW ?? 0) + 4, y: y + barH + 13, "font-size": FS.small, "font-weight": 600, fill: rightTextFill }, [row.expectedText]),
      );
    }
    children.push(el("g", undefined, groupChildren));
  });

  if (stacked) {
    // Stacked rows put labels above the bars; draw the zero axis only beside
    // the bars so it never strikes through a label.
    spec.data.forEach((_, index) => {
      const y = topY + index * rowStep + 20;
      children.push(el("line", { x1: mid, y1: y - 3, x2: mid, y2: y + barH + 3, stroke: INK, "stroke-width": 1.25 }));
    });
  } else {
    children.push(el("line", { x1: mid, y1: titleOffset + 20, x2: mid, y2: axisBottom, stroke: INK, "stroke-width": 1.25 }));
  }

  return svgRoot(width, height, ariaLabel, children);
}

function buildIconArray(spec: IconArrayFigureSpec, ariaLabel: string, opts: FigureLayoutOptions): SvgElementNode {
  const natural = 360;
  const width = clampWidth(opts.width, natural);
  const cols = 25;
  const dotStep = 9;
  const dotRadius = 3.2;
  const gridWidth = cols * dotStep;
  const longestLabel = Math.max(...spec.data.map((d) => textWidth(d.label, FS.label)), 40);
  const stacked = longestLabel + 12 + gridWidth > width;
  const gridX = stacked ? dotRadius : Math.min(longestLabel + 12, width - gridWidth);
  const titleOffset = (spec.title ? 24 : 4) + titleExtra(spec.title, width);

  let cursorY = titleOffset;
  const laidOut = spec.data.map((row) => {
    const dotRows = Math.max(1, Math.ceil(Math.min(row.of, 400) / cols));
    const y0 = cursorY;
    cursorY += (stacked ? 18 : 0) + Math.max(stacked ? dotRows : 3, dotRows) * dotStep + 12;
    return { ...row, y0 };
  });

  const children: SvgChild[] = [...titleNode(spec.title, width)];
  for (const row of laidOut) {
    const activeFill = toneFill(row.tone ?? "benefit");
    const total = Math.min(row.of, 400);
    const gridTop = row.y0 + (stacked ? 18 : 0);
    const groupChildren: SvgChild[] = [
      el("text", { x: 0, y: row.y0 + 12, "font-size": FS.label, "font-weight": 700, fill: INK }, [row.label]),
    ];
    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const r = Math.floor(i / cols);
      groupChildren.push(
        el("circle", {
          cx: gridX + dotRadius + col * dotStep,
          cy: gridTop + 4 + r * dotStep,
          r: dotRadius,
          fill: i < row.count ? activeFill : NEUTRAL_SOFT,
        }),
      );
    }
    children.push(el("g", undefined, groupChildren));
  }

  return svgRoot(width, cursorY, ariaLabel, children);
}

function buildTimeline(spec: TimelineFigureSpec, ariaLabel: string, opts: FigureLayoutOptions): SvgElementNode {
  const count = spec.data.length;
  const natural = Math.max(480, count * 136);
  const width = clampWidth(opts.width, natural);
  const titleOffset = (spec.title ? 24 : 4) + titleExtra(spec.title, width);
  const children: SvgChild[] = [...titleNode(spec.title, width)];

  // Narrow containers: a vertical rail, dates left, labels right.
  if (opts.width !== undefined && width < count * 112) {
    const dateW = Math.max(...spec.data.map((d) => textWidth(d.date, FS.value)), 30) + 10;
    const railX = dateW + 8;
    const labelX = railX + 16;
    const maxChars = Math.max(12, Math.floor((width - labelX) / (FS.label * 0.56)));
    let y = titleOffset + 14;
    const rows = spec.data.map((item) => {
      const lines = wrapLines(item.label, maxChars);
      const row = { item, lines, y };
      y += Math.max(1, lines.length) * 15 + 14;
      return row;
    });
    const height = y - 4;
    children.push(el("line", { x1: railX, y1: titleOffset + 8, x2: railX, y2: height - 10, stroke: RULE, "stroke-width": 2 }));
    for (const { item, lines, y: rowY } of rows) {
      const groupChildren: SvgChild[] = [
        el("text", { x: dateW, y: rowY + 4, "text-anchor": "end", "font-size": FS.value, "font-weight": 700, fill: toneText(item.tone ?? "ink") }, [item.date]),
        el("circle", { cx: railX, cy: rowY, r: 6, fill: toneFill(item.tone ?? "benefit"), stroke: SURFACE, "stroke-width": 2 }),
      ];
      lines.forEach((line, lineIndex) => {
        groupChildren.push(el("text", { x: labelX, y: rowY + 4 + lineIndex * 15, "font-size": FS.label, fill: INK }, [line]));
      });
      children.push(el("g", undefined, groupChildren));
    }
    return svgRoot(width, height, ariaLabel, children);
  }

  // Size the end padding so the first and last labels are never clipped.
  const roughSpan = count > 1 ? width / count : width;
  const maxChars = Math.max(10, Math.floor(roughSpan / (FS.small * 0.56)) - 1);
  const allLines = spec.data.map((d) => wrapLines(d.label, maxChars));
  const halfWidth = (index: number) =>
    Math.max(
      textWidth(spec.data[index]!.date, FS.value),
      ...allLines[index]!.map((line) => textWidth(line, FS.small)),
    ) / 2;
  const padX = count > 1 ? Math.min(width / 4, Math.max(halfWidth(0), halfWidth(count - 1), 12) + 4) : 0;
  const span = count > 1 ? (width - padX * 2) / (count - 1) : 0;
  const railY = titleOffset + 30;
  const maxLines = Math.max(...allLines.map((l) => l.length), 1);
  const height = railY + 24 + maxLines * 14 + 4;
  children.push(
    el("line", { x1: padX, y1: railY, x2: count > 1 ? width - padX : padX, y2: railY, stroke: RULE, "stroke-width": 2 }),
  );
  spec.data.forEach((item, index) => {
    const cx = count > 1 ? padX + index * span : width / 2;
    const groupChildren: SvgChild[] = [
      el("text", { x: cx, y: railY - 12, "text-anchor": "middle", "font-size": FS.value, "font-weight": 700, fill: toneText(item.tone ?? "ink") }, [item.date]),
      el("circle", { cx, cy: railY, r: 6, fill: toneFill(item.tone ?? "benefit"), stroke: SURFACE, "stroke-width": 2 }),
    ];
    allLines[index]!.forEach((line, lineIndex) => {
      groupChildren.push(
        el("text", { x: cx, y: railY + 22 + lineIndex * 14, "text-anchor": "middle", "font-size": FS.small, fill: INK_MUTED }, [line]),
      );
    });
    children.push(el("g", undefined, groupChildren));
  });

  return svgRoot(width, height, ariaLabel, children);
}

export function buildFigureSvgNode(spec: FigureSpec, opts: FigureLayoutOptions = {}): SvgElementNode {
  const { ariaLabel } = figureTableData(spec);
  if (spec.type === "bars") {
    return spec.orientation === "vertical"
      ? buildVerticalBars(spec, ariaLabel, opts)
      : buildHorizontalBars(spec, ariaLabel, opts);
  }
  if (spec.type === "diverging") return buildDiverging(spec, ariaLabel, opts);
  if (spec.type === "icon-array") return buildIconArray(spec, ariaLabel, opts);
  return buildTimeline(spec, ariaLabel, opts);
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
