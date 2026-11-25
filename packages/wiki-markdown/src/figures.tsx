import type { ReactNode } from "react";
import {
  figureTableData,
  formatBarValue,
  parseFigureSpec,
  type BarsFigureSpec,
  type DivergingFigureSpec,
  type FigureSpec,
  type FigureTone,
  type IconArrayFigureSpec,
  type TimelineFigureSpec,
} from "./figure-spec.ts";

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

function HorizontalBarsSvg({ spec, ariaLabel }: { spec: BarsFigureSpec; ariaLabel: string }) {
  const width = 360;
  const maxVal = Math.max(...spec.data.map((d) => Math.abs(d.value)), 1);
  const maxLabelChars = Math.max(...spec.data.map((d) => d.label.length), 8);
  const labelWidth = Math.min(168, Math.max(96, maxLabelChars * 6 + 12));
  const valueAllowance = 46;
  const barMaxWidth = Math.max(80, width - labelWidth - valueAllowance - 12);
  const titleOffset = spec.title ? 20 : 4;
  const rowStep = 28;
  const height = titleOffset + spec.data.length * rowStep + 4;

  return (
    <svg
      className="wiki-data-figure__svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {spec.title ? (
        <text x={0} y={13} fontSize={10.5} fontWeight={700} fill={INK}>
          {spec.title}
        </text>
      ) : null}
      {spec.data.map((item, index) => {
        const y = titleOffset + index * rowStep;
        const barW = Math.max(4, (Math.abs(item.value) / maxVal) * barMaxWidth);
        const valueLabel = formatBarValue(item, spec.unit);
        return (
          <g key={`${item.label}-${index}`}>
            <text
              x={labelWidth - 8}
              y={y + 15}
              textAnchor="end"
              fontSize={10}
              fill={INK}
            >
              {item.label}
            </text>
            <rect
              x={labelWidth}
              y={y + 2}
              width={barW}
              height={18}
              rx={4}
              fill={toneFill(item.tone ?? "benefit")}
            />
            <text
              x={labelWidth + barW + 6}
              y={y + 15}
              fontSize={10.5}
              fontWeight={700}
              fill={INK}
            >
              {valueLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function VerticalBarsSvg({ spec, ariaLabel }: { spec: BarsFigureSpec; ariaLabel: string }) {
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

  return (
    <svg
      className="wiki-data-figure__svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {spec.title ? (
        <text x={0} y={13} fontSize={10.5} fontWeight={700} fill={INK}>
          {spec.title}
        </text>
      ) : null}
      <line x1={0} y1={baselineY} x2={width} y2={baselineY} stroke={RULE} strokeWidth={1} />
      {spec.data.map((item, index) => {
        const h = Math.max(4, (Math.abs(item.value) / maxVal) * maxBarHeight);
        const x = startX + index * (barWidth + gap);
        const fill = toneFill(item.tone ?? "neutral");
        const valueLabel = formatBarValue(item, spec.unit);
        return (
          <g key={`${item.label}-${index}`}>
            <rect x={x} y={baselineY - h} width={barWidth} height={h} rx={4} fill={fill} />
            {h > 6 ? <rect x={x} y={baselineY - 4} width={barWidth} height={4} fill={fill} /> : null}
            <text
              x={x + barWidth / 2}
              y={baselineY - h - 5}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill={INK}
            >
              {valueLabel}
            </text>
            <text
              x={x + barWidth / 2}
              y={baselineY + 14}
              textAnchor="middle"
              fontSize={9.5}
              fill={INK_MUTED}
            >
              {item.label}
            </text>
          </g>
        );
      })}
      {hasBracket && spec.bracket ? (() => {
        const x1 = startX + spec.bracket.from * (barWidth + gap);
        const x2 = startX + spec.bracket.to * (barWidth + gap) + barWidth;
        const bracketColor = toneFill(spec.bracket.tone ?? "cost");
        const bracketText = toneText(spec.bracket.tone ?? "cost");
        return (
          <g>
            <line
              x1={x1}
              y1={baselineY + 21}
              x2={x2}
              y2={baselineY + 21}
              stroke={bracketColor}
              strokeWidth={1.6}
            />
            <text
              x={(x1 + x2) / 2}
              y={baselineY + 35}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill={bracketText}
            >
              {spec.bracket.label}
            </text>
          </g>
        );
      })() : null}
    </svg>
  );
}

function DivergingSvg({ spec, ariaLabel }: { spec: DivergingFigureSpec; ariaLabel: string }) {
  const width = 640;
  const mid = 315;
  const maxLeft = Math.max(...spec.data.map((d) => d.left), 0.1);
  const maxRight = Math.max(...spec.data.map((d) => Math.max(d.right, d.expected ?? 0)), 0.1);
  const leftBarMax = 96;
  const rightBarMax = 178;
  const unit = Math.min(leftBarMax / maxLeft, rightBarMax / maxRight);
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

  return (
    <svg
      className="wiki-data-figure__svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {spec.title ? (
        <text x={0} y={13} fontSize={11} fontWeight={700} fill={INK}>
          {spec.title}
        </text>
      ) : null}
      <text x={mid - 10} y={headerY} textAnchor="end" fontSize={10.5} fontWeight={700} fill={leftTextFill}>
        {`◀ ${spec.leftLabel}`}
      </text>
      <text x={mid + 10} y={headerY} textAnchor="start" fontSize={10.5} fontWeight={700} fill={rightTextFill}>
        {`${spec.rightLabel} ▶`}
      </text>
      {spec.data.map((row, index) => {
        const y = topY + index * rowStep;
        const leftW = Math.max(4, row.left * unit);
        const rightW = Math.max(4, row.right * unit);
        const expW = row.expected !== undefined ? Math.max(4, row.expected * unit) : null;
        const leftText = row.leftText ?? `−${row.left}`;
        const rightText = row.rightText ?? `+${row.right}`;

        return (
          <g key={`${row.label}-${index}`}>
            <text x={0} y={y + 15} fontSize={11} fontWeight={700} fill={INK}>
              {row.label}
            </text>
            <rect x={mid - leftW} y={y} width={leftW} height={22} rx={4} fill={leftFill} />
            <text x={mid - leftW - 6} y={y + 15} textAnchor="end" fontSize={10.5} fill={INK}>
              {leftText}
            </text>
            <rect
              x={mid}
              y={y}
              width={rightW}
              height={22}
              rx={4}
              fill={expW !== null ? rightSoftFill : rightFill}
            />
            {expW !== null ? (
              <rect x={mid} y={y} width={expW} height={22} rx={4} fill={rightFill} />
            ) : null}
            <text x={mid + rightW + 6} y={y + 15} fontSize={10.5} fill={INK}>
              {rightText}
            </text>
            {row.expectedText ? (
              <text
                x={mid + (expW ?? 0) + 4}
                y={y + 36}
                fontSize={9}
                fontWeight={600}
                fill={rightTextFill}
              >
                {row.expectedText}
              </text>
            ) : null}
          </g>
        );
      })}
      <line x1={mid} y1={titleOffset + 20} x2={mid} y2={axisBottom} stroke={INK} strokeWidth={1.25} />
    </svg>
  );
}

function IconArraySvg({ spec, ariaLabel }: { spec: IconArrayFigureSpec; ariaLabel: string }) {
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
  const height = cursorY;

  return (
    <svg
      className="wiki-data-figure__svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {spec.title ? (
        <text x={0} y={13} fontSize={10.5} fontWeight={700} fill={INK}>
          {spec.title}
        </text>
      ) : null}
      {laidOut.map((row, rowIndex) => {
        const activeFill = toneFill(row.tone ?? "benefit");
        const dots: ReactNode[] = [];
        const total = Math.min(row.of, 400);
        for (let i = 0; i < total; i++) {
          const col = i % cols;
          const r = Math.floor(i / cols);
          dots.push(
            <circle
              key={i}
              cx={gridX + col * dotStep}
              cy={row.y0 + 4 + r * dotStep}
              r={dotRadius}
              fill={i < row.count ? activeFill : NEUTRAL_SOFT}
            />,
          );
        }
        return (
          <g key={`${row.label}-${rowIndex}`}>
            <text x={0} y={row.y0 + 11} fontSize={10} fontWeight={700} fill={INK}>
              {row.label}
            </text>
            {dots}
          </g>
        );
      })}
    </svg>
  );
}

function TimelineSvg({ spec, ariaLabel }: { spec: TimelineFigureSpec; ariaLabel: string }) {
  const count = spec.data.length;
  const width = Math.max(460, count * 130);
  const padX = 56;
  const titleOffset = spec.title ? 20 : 4;
  const railY = titleOffset + 28;
  const maxLines = Math.max(...spec.data.map((d) => wrapLines(d.label, 18).length), 1);
  const height = railY + 22 + maxLines * 13 + 6;
  const span = count > 1 ? (width - padX * 2) / (count - 1) : 0;

  return (
    <svg
      className="wiki-data-figure__svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {spec.title ? (
        <text x={0} y={13} fontSize={10.5} fontWeight={700} fill={INK}>
          {spec.title}
        </text>
      ) : null}
      <line
        x1={padX}
        y1={railY}
        x2={count > 1 ? width - padX : padX}
        y2={railY}
        stroke={RULE}
        strokeWidth={2}
      />
      {spec.data.map((item, index) => {
        const cx = count > 1 ? padX + index * span : width / 2;
        const fill = toneFill(item.tone ?? "benefit");
        const dateColor = toneText(item.tone ?? "ink");
        const labelLines = wrapLines(item.label, 18);
        return (
          <g key={`${item.date}-${index}`}>
            <text
              x={cx}
              y={railY - 12}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={700}
              fill={dateColor}
            >
              {item.date}
            </text>
            <circle cx={cx} cy={railY} r={6} fill={fill} stroke={SURFACE} strokeWidth={2} />
            {labelLines.map((line, lineIndex) => (
              <text
                key={lineIndex}
                x={cx}
                y={railY + 20 + lineIndex * 13}
                textAnchor="middle"
                fontSize={9.5}
                fill={INK_MUTED}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function FigureSvg({ spec }: { spec: FigureSpec }) {
  const { ariaLabel } = figureTableData(spec);
  if (spec.type === "bars") {
    return spec.orientation === "vertical" ? (
      <VerticalBarsSvg spec={spec} ariaLabel={ariaLabel} />
    ) : (
      <HorizontalBarsSvg spec={spec} ariaLabel={ariaLabel} />
    );
  }
  if (spec.type === "diverging") {
    return <DivergingSvg spec={spec} ariaLabel={ariaLabel} />;
  }
  if (spec.type === "icon-array") {
    return <IconArraySvg spec={spec} ariaLabel={ariaLabel} />;
  }
  return <TimelineSvg spec={spec} ariaLabel={ariaLabel} />;
}

export function FigureAccessibleTable({
  spec,
  visuallyHidden,
}: {
  spec: FigureSpec;
  visuallyHidden?: boolean;
}) {
  const { headers, rows } = figureTableData(spec);
  return (
    <table
      className={
        visuallyHidden
          ? "wiki-data-figure__table wiki-sr-only"
          : "wiki-data-figure__table"
      }
    >
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WikiFigureRendered({ spec }: { spec: FigureSpec }) {
  return (
    <figure
      className="wiki-data-figure"
      data-figure-type={spec.type}
      data-figure-rendered="true"
      data-test-id="wiki-figure"
    >
      <FigureSvg spec={spec} />
      {spec.caption ? (
        <figcaption className="wiki-data-figure__caption">{spec.caption}</figcaption>
      ) : null}
      <FigureAccessibleTable spec={spec} visuallyHidden />
    </figure>
  );
}

export function WikiFigureFromSource({ source }: { source: string }) {
  const parsed = parseFigureSpec(source);
  if (!parsed.ok) {
    return (
      <figure className="wiki-data-figure wiki-data-figure--error" data-test-id="wiki-figure">
        <figcaption className="wiki-data-figure__caption">
          Figure could not be rendered: {parsed.error}
        </figcaption>
        <pre>
          <code>{source}</code>
        </pre>
      </figure>
    );
  }
  return <WikiFigureRendered spec={parsed.spec} />;
}
