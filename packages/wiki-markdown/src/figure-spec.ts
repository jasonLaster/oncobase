/**
 * Dependency-free YAML parser and typed schema for ```figure blocks.
 *
 * Kept lightweight so `toPortableMarkdown` (page-copy / Talk), the static
 * accessible table fallback in `renderer.tsx`, and the lazy SVG chart renderer
 * in `figures.tsx` all share one parser without pulling a full YAML library
 * onto the reader's paint path.
 */

export type FigureTone = "benefit" | "benefit-soft" | "cost" | "neutral" | "ink";

export type BarsItem = {
  label: string;
  value: number;
  display?: string;
  tone?: FigureTone;
};

export type BarsBracket = {
  from: number;
  to: number;
  label: string;
  tone?: FigureTone;
};

export type BarsFigureSpec = {
  type: "bars";
  title?: string;
  caption?: string;
  orientation: "horizontal" | "vertical";
  unit: string;
  data: BarsItem[];
  bracket?: BarsBracket;
  /** Fixed scale maximum (e.g. 100 for a true 0–100% axis). Defaults to the largest value. */
  max?: number;
};

export type DivergingItem = {
  label: string;
  left: number;
  leftText?: string;
  /** Optional upper bound drawn as a lighter extension beyond the central `left` bar. */
  leftHigh?: number;
  right: number;
  rightText?: string;
  /** Optional upper bound drawn as a lighter extension beyond the central `right` bar. */
  rightHigh?: number;
  expected?: number;
  expectedText?: string;
};

export type DivergingFigureSpec = {
  type: "diverging";
  title?: string;
  caption?: string;
  leftLabel: string;
  rightLabel: string;
  leftTone: FigureTone;
  rightTone: FigureTone;
  data: DivergingItem[];
};

export type IconArrayItem = {
  label: string;
  count: number;
  of: number;
  tone?: FigureTone;
};

export type IconArrayFigureSpec = {
  type: "icon-array";
  title?: string;
  caption?: string;
  data: IconArrayItem[];
};

export type TimelineItem = {
  date: string;
  label: string;
  tone?: FigureTone;
};

export type TimelineFigureSpec = {
  type: "timeline";
  title?: string;
  caption?: string;
  data: TimelineItem[];
};

export type FigureSpec =
  | BarsFigureSpec
  | DivergingFigureSpec
  | IconArrayFigureSpec
  | TimelineFigureSpec;

export type FigureParseResult =
  | { ok: true; spec: FigureSpec }
  | { ok: false; error: string };

const VALID_TONES = new Set<FigureTone>(["benefit", "benefit-soft", "cost", "neutral", "ink"]);

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function findKeyColon(line: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === ":" && depth === 0) {
      const next = line[i + 1];
      if (next === undefined || /\s/.test(next)) return i;
    }
  }
  return -1;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (!s) return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    const obj: Record<string, unknown> = {};
    if (!inner) return obj;
    for (const entry of splitTopLevel(inner, ",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const colon = findKeyColon(trimmed);
      if (colon === -1) throw new Error(`Invalid mapping entry "${trimmed}"`);
      const key = String(parseScalar(trimmed.slice(0, colon))).trim();
      const val = parseScalar(trimmed.slice(colon + 1));
      obj[key] = val;
    }
    return obj;
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(parseScalar);
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) {
    return Number(s);
  }
  return s;
}

type YamlLine = { indent: number; text: string };

function tokenizeYaml(source: string): YamlLine[] {
  const lines: YamlLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const cleaned = stripComment(raw).replace(/[ \t]+$/, "");
    if (!cleaned.trim()) continue;
    const indent = cleaned.length - cleaned.trimStart().length;
    lines.push({ indent, text: cleaned.trimStart() });
  }
  return lines;
}

function parseBlock(lines: YamlLine[], start: number, minIndent: number): { value: unknown; next: number } {
  if (start >= lines.length) return { value: null, next: start };
  const first = lines[start]!;
  if (first.text === "-" || first.text.startsWith("- ")) {
    return parseSequence(lines, start, first.indent);
  }
  return parseMapping(lines, start, minIndent);
}

function parseSequence(lines: YamlLine[], start: number, seqIndent: number): { value: unknown[]; next: number } {
  const items: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < seqIndent) break;
    if (line.indent > seqIndent || !(line.text === "-" || line.text.startsWith("- "))) break;

    const rest = line.text === "-" ? "" : line.text.slice(2).trim();
    if (!rest) {
      i++;
      if (i < lines.length && lines[i]!.indent > seqIndent) {
        const nested = parseBlock(lines, i, lines[i]!.indent);
        items.push(nested.value);
        i = nested.next;
      } else {
        items.push(null);
      }
      continue;
    }

    if (rest.startsWith("{") || rest.startsWith("[") || rest.startsWith('"') || rest.startsWith("'")) {
      items.push(parseScalar(rest));
      i++;
      continue;
    }

    const colon = findKeyColon(rest);
    if (colon !== -1) {
      const obj: Record<string, unknown> = {};
      const key = String(parseScalar(rest.slice(0, colon))).trim();
      const valStr = rest.slice(colon + 1).trim();
      i++;
      if (valStr) {
        obj[key] = parseScalar(valStr);
      } else if (i < lines.length && lines[i]!.indent > seqIndent + 2) {
        const nested = parseBlock(lines, i, lines[i]!.indent);
        obj[key] = nested.value;
        i = nested.next;
      } else {
        obj[key] = null;
      }
      if (i < lines.length && lines[i]!.indent > seqIndent) {
        const extra = parseMapping(lines, i, lines[i]!.indent);
        Object.assign(obj, extra.value);
        i = extra.next;
      }
      items.push(obj);
    } else {
      items.push(parseScalar(rest));
      i++;
    }
  }

  return { value: items, next: i };
}

function parseMapping(
  lines: YamlLine[],
  start: number,
  mapIndent: number,
): { value: Record<string, unknown>; next: number } {
  const obj: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < mapIndent) break;
    if (line.indent > mapIndent) {
      throw new Error(`Unexpected indentation near "${line.text}"`);
    }
    if (line.text === "-" || line.text.startsWith("- ")) break;

    const colon = findKeyColon(line.text);
    if (colon === -1) {
      throw new Error(`Expected "key: value" near "${line.text}"`);
    }
    const key = String(parseScalar(line.text.slice(0, colon))).trim();
    const valStr = line.text.slice(colon + 1).trim();
    i++;

    if (valStr) {
      obj[key] = parseScalar(valStr);
    } else if (i < lines.length && lines[i]!.indent > mapIndent) {
      const nested = parseBlock(lines, i, lines[i]!.indent);
      obj[key] = nested.value;
      i = nested.next;
    } else if (i < lines.length && lines[i]!.indent === mapIndent && (lines[i]!.text === "-" || lines[i]!.text.startsWith("- "))) {
      // YAML allows sequence items at the same indent as the parent mapping key.
      const nested = parseSequence(lines, i, mapIndent);
      obj[key] = nested.value;
      i = nested.next;
    } else {
      obj[key] = null;
    }
  }

  return { value: obj, next: i };
}

export function parseSimpleYaml(source: string): unknown {
  const lines = tokenizeYaml(source);
  if (lines.length === 0) return {};
  const { value } = parseBlock(lines, 0, lines[0]!.indent);
  return value;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function optionalAbs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.abs(value);
}

/** Display text for one side of a diverging row; "—" when the side is empty. */
export function divergingSideText(
  value: number,
  text: string | undefined,
  high: number | undefined,
  sign: "−" | "+",
): string {
  if (text !== undefined) return text;
  if (value === 0 && !high) return "—";
  return high !== undefined && high > value ? `${sign}${value} (to ${sign}${high})` : `${sign}${value}`;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asTone(value: unknown): FigureTone | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase() as FigureTone;
  return VALID_TONES.has(lower) ? lower : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFigureSpec(source: string): FigureParseResult {
  let raw: unknown;
  try {
    raw = parseSimpleYaml(source);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid figure YAML" };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "Figure definition must be a YAML mapping." };
  }

  const type = asString(raw.type)?.trim().toLowerCase();
  const title = asString(raw.title)?.trim() || undefined;
  const caption = asString(raw.caption)?.trim() || undefined;
  const rawData = Array.isArray(raw.data) ? raw.data : null;

  if (!rawData || rawData.length === 0) {
    return { ok: false, error: "Figure must include a non-empty data list." };
  }

  if (type === "bars") {
    const orientation = asString(raw.orientation)?.trim().toLowerCase() === "vertical"
      ? "vertical"
      : "horizontal";
    const unit = asString(raw.unit) ?? "";
    const data: BarsItem[] = [];
    for (const entry of rawData) {
      if (!isRecord(entry)) return { ok: false, error: "Each bars item must be an object." };
      const label = asString(entry.label)?.trim();
      const value = asNumber(entry.value);
      if (!label || value === undefined) {
        return { ok: false, error: "Each bars item needs a label and numeric value." };
      }
      data.push({
        label,
        value,
        display: asString(entry.display)?.trim() || undefined,
        tone: asTone(entry.tone),
      });
    }

    let bracket: BarsBracket | undefined;
    if (isRecord(raw.bracket)) {
      const from = asNumber(raw.bracket.from);
      const to = asNumber(raw.bracket.to);
      const label = asString(raw.bracket.label)?.trim();
      if (from !== undefined && to !== undefined && label) {
        bracket = { from, to, label, tone: asTone(raw.bracket.tone) };
      }
    }

    const max = asNumber(raw.max);
    return {
      ok: true,
      spec: {
        type: "bars",
        title,
        caption,
        orientation,
        unit,
        data,
        bracket,
        ...(max !== undefined && max > 0 ? { max } : {}),
      },
    };
  }

  if (type === "diverging") {
    const leftLabel = asString(raw.leftLabel ?? raw.left_label)?.trim() || "Cost";
    const rightLabel = asString(raw.rightLabel ?? raw.right_label)?.trim() || "Gain";
    const leftTone = asTone(raw.leftTone ?? raw.left_tone) ?? "cost";
    const rightTone = asTone(raw.rightTone ?? raw.right_tone) ?? "benefit";
    const data: DivergingItem[] = [];
    for (const entry of rawData) {
      if (!isRecord(entry)) return { ok: false, error: "Each diverging item must be an object." };
      const label = asString(entry.label)?.trim();
      const left = asNumber(entry.left ?? entry.cost);
      const right = asNumber(entry.right ?? entry.gain);
      if (!label || left === undefined || right === undefined) {
        return { ok: false, error: "Each diverging item needs label, left, and right values." };
      }
      data.push({
        label,
        left: Math.abs(left),
        leftText: asString(entry.leftText ?? entry.left_text ?? entry.costText)?.trim() || undefined,
        leftHigh: optionalAbs(asNumber(entry.leftHigh ?? entry.left_high)),
        right: Math.abs(right),
        rightText: asString(entry.rightText ?? entry.right_text ?? entry.gainText)?.trim() || undefined,
        rightHigh: optionalAbs(asNumber(entry.rightHigh ?? entry.right_high)),
        expected: asNumber(entry.expected),
        expectedText: asString(entry.expectedText ?? entry.expected_text)?.trim() || undefined,
      });
    }
    return {
      ok: true,
      spec: { type: "diverging", title, caption, leftLabel, rightLabel, leftTone, rightTone, data },
    };
  }

  if (type === "icon-array") {
    const data: IconArrayItem[] = [];
    for (const entry of rawData) {
      if (!isRecord(entry)) return { ok: false, error: "Each icon-array item must be an object." };
      const label = asString(entry.label)?.trim();
      const count = asNumber(entry.count);
      const of = asNumber(entry.of) ?? 100;
      if (!label || count === undefined || of <= 0) {
        return { ok: false, error: "Each icon-array item needs label, count, and positive total." };
      }
      data.push({ label, count: Math.max(0, Math.min(count, of)), of: Math.round(of), tone: asTone(entry.tone) });
    }
    return { ok: true, spec: { type: "icon-array", title, caption, data } };
  }

  if (type === "timeline") {
    const data: TimelineItem[] = [];
    for (const entry of rawData) {
      if (!isRecord(entry)) return { ok: false, error: "Each timeline item must be an object." };
      const date = asString(entry.date)?.trim();
      const label = asString(entry.label)?.trim();
      if (!date || !label) {
        return { ok: false, error: "Each timeline item needs date and label." };
      }
      data.push({ date, label, tone: asTone(entry.tone) });
    }
    return { ok: true, spec: { type: "timeline", title, caption, data } };
  }

  return { ok: false, error: `Unsupported figure type "${type ?? ""}".` };
}

export function formatBarValue(item: BarsItem, unit: string): string {
  return item.display ?? `${item.value}${unit}`;
}

export type FigureTableData = {
  headers: string[];
  rows: string[][];
  ariaLabel: string;
};

export function figureTableData(spec: FigureSpec): FigureTableData {
  if (spec.type === "bars") {
    const rows = spec.data.map((item) => [item.label, formatBarValue(item, spec.unit)]);
    const summary = rows.map(([label, val]) => `${label}: ${val}`).join("; ");
    const ariaLabel = [spec.title, summary, spec.bracket?.label, spec.caption].filter(Boolean).join(". ");
    return { headers: ["Item", "Value"], rows, ariaLabel };
  }

  if (spec.type === "diverging") {
    const hasExpected = spec.data.some((item) => item.expected !== undefined || item.expectedText);
    const headers = hasExpected
      ? ["Measure", spec.leftLabel, spec.rightLabel, "Expected"]
      : ["Measure", spec.leftLabel, spec.rightLabel];
    const rows = spec.data.map((item) => {
      const left = divergingSideText(item.left, item.leftText, item.leftHigh, "−");
      const right = divergingSideText(item.right, item.rightText, item.rightHigh, "+");
      if (!hasExpected) return [item.label, left, right];
      const exp = item.expectedText ?? (item.expected !== undefined ? `+${item.expected}` : "—");
      return [item.label, left, right, exp];
    });
    const summary = spec.data
      .map(
        (item) =>
          `${item.label}: ${divergingSideText(item.left, item.leftText, item.leftHigh, "−")} vs ${divergingSideText(item.right, item.rightText, item.rightHigh, "+")}`,
      )
      .join("; ");
    const ariaLabel = [spec.title, summary, spec.caption].filter(Boolean).join(". ");
    return { headers, rows, ariaLabel };
  }

  if (spec.type === "icon-array") {
    const rows = spec.data.map((item) => [item.label, `${item.count} of ${item.of}`]);
    const summary = rows.map(([label, count]) => `${label} (${count})`).join("; ");
    const ariaLabel = [spec.title, summary, spec.caption].filter(Boolean).join(". ");
    return { headers: ["Group", "Count"], rows, ariaLabel };
  }

  const rows = spec.data.map((item) => [item.date, item.label]);
  const summary = rows.map(([date, label]) => `${date}: ${label}`).join("; ");
  const ariaLabel = [spec.title, summary, spec.caption].filter(Boolean).join(". ");
  return { headers: ["Date", "Event"], rows, ariaLabel };
}

/**
 * Render a ```figure block as clean, text-first markdown for copy-as-markdown
 * and Talk: `**Figure: title.** caption` followed by a bullet list of the data.
 */
export function figureToPortableMarkdown(source: string): string {
  const parsed = parseFigureSpec(source);
  if (!parsed.ok) {
    return `\`\`\`figure\n${source.trimEnd()}\n\`\`\``;
  }

  const { spec } = parsed;
  const lines: string[] = [];
  if (spec.title && spec.caption) {
    lines.push(`**Figure: ${spec.title}.** ${spec.caption}`);
  } else if (spec.title) {
    lines.push(`**Figure: ${spec.title}.**`);
  } else if (spec.caption) {
    lines.push(`**Figure.** ${spec.caption}`);
  }

  if (spec.type === "bars") {
    for (const item of spec.data) {
      lines.push(`- ${item.label}: ${formatBarValue(item, spec.unit)}`);
    }
    if (spec.bracket) {
      lines.push(`- ${spec.bracket.label}`);
    }
  } else if (spec.type === "diverging") {
    for (const item of spec.data) {
      const left = divergingSideText(item.left, item.leftText, item.leftHigh, "−");
      const right = divergingSideText(item.right, item.rightText, item.rightHigh, "+");
      const exp = item.expectedText
        ? `; ${item.expectedText}`
        : item.expected !== undefined
          ? `; expected +${item.expected}`
          : "";
      lines.push(`- ${item.label}: ${spec.leftLabel} ${left}; ${spec.rightLabel} ${right}${exp}`);
    }
  } else if (spec.type === "icon-array") {
    for (const item of spec.data) {
      lines.push(`- ${item.label}: ${item.count} of ${item.of}`);
    }
  } else {
    for (const item of spec.data) {
      lines.push(`- ${item.date}: ${item.label}`);
    }
  }

  return lines.join("\n");
}
