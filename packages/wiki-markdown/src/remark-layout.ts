type MdastNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MdastNode[];
  data?: Record<string, unknown>;
};

const COLUMNS_OPEN_LINE_RE = /^[ \t]*:::columns(?:\{([^}\n]*)\})?[ \t]*$/;
const CONTAINER_OPEN_LINE_RE = /^[ \t]*:::[A-Za-z][A-Za-z0-9_-]*(?:\{[^}\n]*\}|\[[^\]\n]*\])?[ \t]*$/;
const CONTAINER_CLOSE_LINE_RE = /^[ \t]*:::[ \t]*$/;
const CODE_FENCE_LINE_RE = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/;
const PAGE_BREAK_HTML_RE = /^<!--\s*page-break\s*-->$/i;

const CALLOUT_HEADER_RE = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-])?(?:[ \t]+([^\r\n]*))?/;

export type CalloutTone = "tint" | "benefit" | "cost" | "lead" | "quote";

const CALLOUT_TONE_BY_TYPE: Record<string, CalloutTone> = {
  note: "tint",
  info: "tint",
  example: "tint",
  question: "benefit",
  help: "benefit",
  faq: "benefit",
  tip: "benefit",
  hint: "benefit",
  important: "benefit",
  success: "benefit",
  check: "benefit",
  done: "benefit",
  warning: "cost",
  caution: "cost",
  attention: "cost",
  danger: "cost",
  error: "cost",
  failure: "cost",
  fail: "cost",
  missing: "cost",
  bug: "cost",
  summary: "lead",
  abstract: "lead",
  tldr: "lead",
  quote: "quote",
  cite: "quote",
};

const VALID_COLUMN_TONES = new Set(["benefit", "cost", "neutral", "tint", "ink"]);

/**
 * Ensure `:::columns...` and bare `:::` directive marker lines are surrounded
 * by blank lines outside fenced code blocks so CommonMark lazy paragraph
 * continuation never glues them onto adjacent prose or headings.
 */
export function isolateDirectiveLines(markdown: string): string {
  if (!markdown.includes(":::")) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;

  // Split a line into its blockquote prefix (`> > `) and content so markers
  // inside callouts (`> :::columns`) are isolated with `>`-only blank lines.
  const splitQuote = (line: string): { prefix: string; content: string } => {
    const match = line.match(/^((?:[ \t]*>[ \t]?)*)(.*)$/);
    return { prefix: match?.[1] ?? "", content: match?.[2] ?? line };
  };
  const isMarker = (content: string) =>
    COLUMNS_OPEN_LINE_RE.test(content) || CONTAINER_CLOSE_LINE_RE.test(content);
  const isBlank = (line: string | undefined) =>
    line === undefined || splitQuote(line.endsWith("\r") ? line.slice(0, -1) : line).content.trim() === "";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const { prefix, content } = splitQuote(line);
    const fenceMatch = content.match(CODE_FENCE_LINE_RE);

    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1]![0] === fence.char &&
        fenceMatch[1]!.length >= fence.length &&
        !(fenceMatch[2] ?? "").trim()
      ) {
        fence = null;
      }
      out.push(raw);
      continue;
    }

    if (fenceMatch) {
      fence = { char: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      out.push(raw);
      continue;
    }

    if (isMarker(content)) {
      const blank = prefix.trimEnd();
      if (out.length > 0 && !isBlank(out[out.length - 1])) {
        out.push(blank);
      }
      out.push(raw);
      if (!isBlank(lines[i + 1]) && lines[i + 1] !== undefined) {
        out.push(blank);
      }
    } else {
      out.push(raw);
    }
  }

  return out.join("\n");
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function parseColumnsTones(rawAttrs: string | undefined): string[] {
  if (!rawAttrs) return [];
  const toneMatch = rawAttrs.match(/\btone\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/i);
  const value = toneMatch?.[1] ?? toneMatch?.[2] ?? toneMatch?.[3] ?? "";
  return value
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => VALID_COLUMN_TONES.has(token));
}

function splitFirstParagraphAtNewline(children: MdastNode[]): {
  titleChildren: MdastNode[];
  bodyChildren: MdastNode[];
} {
  const titleChildren: MdastNode[] = [];
  const bodyChildren: MdastNode[] = [];
  let inBody = false;

  for (const child of children) {
    if (inBody) {
      bodyChildren.push(child);
      continue;
    }
    if (child.type === "break") {
      inBody = true;
      continue;
    }
    if (child.type === "text" && typeof child.value === "string") {
      const nl = child.value.indexOf("\n");
      if (nl !== -1) {
        const before = child.value.slice(0, nl).replace(/\r$/, "");
        const after = child.value.slice(nl + 1);
        if (before) titleChildren.push({ ...child, value: before });
        if (after) bodyChildren.push({ ...child, value: after });
        inBody = true;
        continue;
      }
    }
    titleChildren.push(child);
  }

  return { titleChildren, bodyChildren };
}

function trimLeadingText(nodes: MdastNode[]): MdastNode[] {
  const out = [...nodes];
  while (out.length > 0 && out[0]!.type === "text") {
    const trimmed = (out[0]!.value ?? "").replace(/^[ \t]+/, "");
    if (trimmed) {
      out[0] = { ...out[0]!, value: trimmed };
      break;
    }
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1]!.type === "text") {
    const trimmed = (out[out.length - 1]!.value ?? "").replace(/[ \t]+$/, "");
    if (trimmed) {
      out[out.length - 1] = { ...out[out.length - 1]!, value: trimmed };
      break;
    }
    out.pop();
  }
  return out;
}

function transformCalloutNode(node: MdastNode): MdastNode | null {
  if (node.type !== "blockquote" || !node.children?.length) return null;
  const first = node.children[0]!;
  if (first.type !== "paragraph" || !first.children?.length) return null;
  const firstInline = first.children[0]!;
  if (firstInline.type !== "text" || typeof firstInline.value !== "string") return null;

  const headerMatch = firstInline.value.match(CALLOUT_HEADER_RE);
  if (!headerMatch) return null;

  const rawType = headerMatch[1]!.toLowerCase();
  const fold = headerMatch[2];
  const tone: CalloutTone = CALLOUT_TONE_BY_TYPE[rawType] ?? "tint";

  // Strip `[!type][+-]?` prefix while keeping any title text and inline nodes.
  const prefixLength = `[!${headerMatch[1]}]${fold ?? ""}`.length;
  const restOfFirstText = firstInline.value.slice(prefixLength);
  const firstParaChildren: MdastNode[] = [
    ...(restOfFirstText ? [{ ...firstInline, value: restOfFirstText }] : []),
    ...first.children.slice(1),
  ];

  const { titleChildren: rawTitleChildren, bodyChildren: firstBodyChildren } =
    splitFirstParagraphAtNewline(firstParaChildren);
  const cleanedTitleChildren = trimLeadingText(rawTitleChildren);
  const titleChildren: MdastNode[] =
    cleanedTitleChildren.length > 0
      ? cleanedTitleChildren
      : [{ type: "text", value: capitalize(rawType) }];

  const bodyBlocks: MdastNode[] = [];
  if (firstBodyChildren.length > 0) {
    bodyBlocks.push({ type: "paragraph", children: firstBodyChildren });
  }
  bodyBlocks.push(...node.children.slice(1));

  const foldable = fold === "-" || fold === "+";
  const classes = ["wiki-callout", `wiki-callout--${rawType}`, `wiki-callout--tone-${tone}`];
  const hProperties: Record<string, unknown> = {
    className: classes,
    dataCallout: rawType,
    dataCalloutTone: tone,
  };
  if (fold === "+") {
    hProperties.open = true;
  }

  const titleNode: MdastNode = {
    type: "wikiCalloutTitle",
    children: titleChildren,
    data: {
      hName: foldable ? "summary" : "div",
      hProperties: { className: ["wiki-callout__title"] },
    },
  };

  const children: MdastNode[] = [titleNode];
  if (bodyBlocks.length > 0) {
    children.push({
      type: "wikiCalloutBody",
      children: bodyBlocks,
      data: {
        hName: "div",
        hProperties: { className: ["wiki-callout__body"] },
      },
    });
  }

  return {
    type: "wikiCallout",
    children,
    data: {
      wikiCallout: true,
      hName: foldable ? "details" : "div",
      hProperties,
    },
  };
}

function paragraphExactText(node: MdastNode): string | null {
  if (node.type !== "paragraph" || !node.children || node.children.length !== 1) return null;
  const child = node.children[0]!;
  if (child.type !== "text" || typeof child.value !== "string") return null;
  return child.value.trim();
}

function splitIntoColumns(nodes: MdastNode[]): MdastNode[][] {
  if (nodes.length === 0) return [];

  const firstHeading = nodes.find((child) => child.type === "heading" && typeof child.depth === "number");
  if (firstHeading && typeof firstHeading.depth === "number") {
    const splitDepth = firstHeading.depth;
    const columns: MdastNode[][] = [];
    let current: MdastNode[] = [];

    for (const child of nodes) {
      if (child.type === "heading" && child.depth === splitDepth) {
        if (current.length > 0) columns.push(current);
        current = [child];
      } else {
        current.push(child);
      }
    }
    if (current.length > 0) columns.push(current);
    return columns;
  }

  const hasCallouts = nodes.some((child) => Boolean(child.data?.wikiCallout));
  if (hasCallouts) {
    const columns: MdastNode[][] = [];
    let loose: MdastNode[] = [];
    for (const child of nodes) {
      if (child.data?.wikiCallout) {
        if (loose.length > 0) {
          columns.push(loose);
          loose = [];
        }
        columns.push([child]);
      } else {
        loose.push(child);
      }
    }
    if (loose.length > 0) columns.push(loose);
    return columns;
  }

  if (nodes.some((child) => child.type === "thematicBreak")) {
    const columns: MdastNode[][] = [];
    let current: MdastNode[] = [];
    for (const child of nodes) {
      if (child.type === "thematicBreak") {
        if (current.length > 0) columns.push(current);
        current = [];
      } else {
        current.push(child);
      }
    }
    if (current.length > 0) columns.push(current);
    return columns;
  }

  // Bold-only lead paragraphs (`**Pathology & surgery**`) act like headings
  // when there are at least two of them.
  const isBoldLead = (child: MdastNode) =>
    child.type === "paragraph" && child.children?.length === 1 && child.children[0]!.type === "strong";
  if (nodes.filter(isBoldLead).length >= 2 && isBoldLead(nodes[0]!)) {
    const columns: MdastNode[][] = [];
    let current: MdastNode[] = [];
    for (const child of nodes) {
      if (isBoldLead(child) && current.length > 0) {
        columns.push(current);
        current = [];
      }
      current.push(child);
    }
    if (current.length > 0) columns.push(current);
    return columns;
  }

  return [nodes];
}

function transformContainerChildren(children: MdastNode[]): MdastNode[] {
  // Pass 1: transform callouts, page breaks, and recurse into children first
  // so `:::columns` sees already-converted `wikiCallout` siblings.
  const pass1: MdastNode[] = children.map((child) => {
    if (child.type === "html" && typeof child.value === "string" && PAGE_BREAK_HTML_RE.test(child.value.trim())) {
      return {
        type: "wikiPageBreak",
        data: {
          hName: "div",
          hProperties: {
            className: ["wiki-page-break"],
            ariaHidden: "true",
          },
        },
      };
    }

    if (child.children) {
      child.children = transformContainerChildren(child.children);
    }

    const callout = transformCalloutNode(child);
    return callout ?? child;
  });

  // Pass 2: group `:::columns{...}` ... `:::` ranges.
  const out: MdastNode[] = [];
  for (let i = 0; i < pass1.length; i++) {
    const node = pass1[i]!;
    const text = paragraphExactText(node);
    const openMatch = text ? text.match(COLUMNS_OPEN_LINE_RE) : null;
    if (!openMatch) {
      out.push(node);
      continue;
    }

    let depth = 1;
    let closeIndex = -1;
    for (let j = i + 1; j < pass1.length; j++) {
      const candidateText = paragraphExactText(pass1[j]!);
      if (!candidateText) continue;
      if (CONTAINER_OPEN_LINE_RE.test(candidateText)) {
        depth += 1;
      } else if (CONTAINER_CLOSE_LINE_RE.test(candidateText)) {
        depth -= 1;
        if (depth === 0) {
          closeIndex = j;
          break;
        }
      }
    }

    if (closeIndex === -1) {
      // Unclosed block: leave untouched so content is never swallowed.
      out.push(node);
      continue;
    }

    const inner = pass1.slice(i + 1, closeIndex);
    const tones = parseColumnsTones(openMatch[1]);
    const columns = splitIntoColumns(inner);
    const count = Math.max(1, columns.length);

    out.push({
      type: "wikiColumns",
      children: columns.map((columnChildren, index) => {
        const tone = tones[index];
        const colClasses = ["wiki-column", ...(tone ? [`wiki-column--${tone}`] : [])];
        const colProps: Record<string, unknown> = { className: colClasses };
        if (tone) colProps.dataColumnTone = tone;
        return {
          type: "wikiColumn",
          children: columnChildren,
          data: {
            hName: "div",
            hProperties: colProps,
          },
        };
      }),
      data: {
        hName: "div",
        hProperties: {
          className: ["wiki-columns", `wiki-columns--${Math.min(count, 4)}`],
          dataColumns: String(count),
        },
      },
    });

    i = closeIndex;
  }

  return out;
}

/**
 * Remark plugin adding text-first handout layout constructs:
 * - Obsidian callouts (`> [!type] Title`)
 * - Side-by-side columns (`:::columns` ... `:::`)
 * - Print page breaks (`<!-- page-break -->`)
 */
export function remarkLayout() {
  return (tree: MdastNode) => {
    if (tree.children) {
      tree.children = transformContainerChildren(tree.children);
    }
  };
}
