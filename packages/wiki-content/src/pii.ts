export const SHOW_PII_QUERY_PARAM = "showPII";

export type PiiRedactionMode = "redacted" | "revealed";

export type PiiPattern = {
  pattern: RegExp;
  replacement: string;
};

export interface ApplyPiiRedactionsOptions {
  mode?: PiiRedactionMode;
  /**
   * Per-site fallback patterns. Each pattern's `pattern` is applied with
   * `String.replace(pattern, replacement)`.
   *
   * If omitted, the legacy Diana-only fallback list is used. Callers that
   * know they're operating on a non-Diana site MUST pass `patterns: []`
   * (or the friend's actual patterns) — otherwise Diana's name/MRN
   * substitutions leak into the friend's content.
   */
  patterns?: PiiPattern[];
  /**
   * Sensitive include criteria granted to the current read. Explicit redaction
   * tags with a matching `sensitive-include` attribute reveal their body in
   * redacted mode while unmatched tags continue to render only their fallback.
   */
  sensitiveIncludes?: string[];
}

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

const BLOCK_REDACTION_RE =
  /^[\t ]*:::redact\b([^\n]*)\r?\n([\s\S]*?)^[\t ]*:::[\t ]*$/gm;

const INLINE_REDACTION_RE =
  /<redact\b([^>]*)>([\s\S]*?)<\/redact>/gi;

const ATTRIBUTE_RE =
  /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const DIANA_FALLBACK_REPLACEMENTS: PiiPattern[] = [
  {
    pattern: /\bjason\.laster\.11@gmail\.com\b/gi,
    replacement: "[redacted email]",
  },
  {
    pattern: /\bdiana\.pechter@gmail\.com\b/gi,
    replacement: "[redacted email]",
  },
  { pattern: /\bDiana Laster\b/gi, replacement: "the patient" },
  { pattern: /\bLaster,\s*Diana\b/gi, replacement: "the patient" },
  { pattern: /\bJason Laster\b/gi, replacement: "the caregiver" },
  { pattern: /\b88855655\b/g, replacement: "[redacted MRN]" },
  { pattern: /\b12\/11\/1989\b/g, replacement: "[redacted DOB]" },
  { pattern: /\b11-Dec-1989\b/g, replacement: "[redacted DOB]" },
];

/**
 * Parse `sites.config.piiPatterns` strings into `PiiPattern[]`.
 *
 * Supported entry forms:
 *   1. JSON object: `{"pattern":"<regex>","flags":"gi","replacement":"<text>"}`
 *   2. Slash-delimited: `/<regex>/<flags>=><replacement>`
 *
 * Invalid entries are skipped with a console warning rather than
 * thrown — a malformed entry should not crash a publish or render.
 */
export function parseSitePiiPatterns(input: string[] | undefined): PiiPattern[] {
  if (!input || input.length === 0) return [];
  const out: PiiPattern[] = [];
  for (const entry of input) {
    try {
      if (entry.trim().startsWith("{")) {
        const obj = JSON.parse(entry) as {
          pattern: string;
          flags?: string;
          replacement?: string;
        };
        out.push({
          pattern: new RegExp(obj.pattern, obj.flags ?? "g"),
          replacement: obj.replacement ?? "",
        });
        continue;
      }
      const slashMatch = entry.match(/^\/(.+)\/([a-z]*)=>(.*)$/);
      if (slashMatch) {
        out.push({
          pattern: new RegExp(slashMatch[1], slashMatch[2]),
          replacement: slashMatch[3],
        });
        continue;
      }
      console.warn(`[pii] unparseable pattern, skipped: ${entry.slice(0, 60)}`);
    } catch (err) {
      console.warn(
        `[pii] pattern compile failed, skipped: ${(err as Error).message}`,
      );
    }
  }
  return out;
}

function normalizeReplacement(
  replacement: string,
  isBlock: boolean
): string {
  if (!replacement) {
    return isBlock ? "\n\n" : "";
  }

  return isBlock ? `\n${replacement}\n` : replacement;
}

function normalizeMarkdownWhitespace(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAttributes(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!raw) return attrs;

  for (const match of raw.matchAll(ATTRIBUTE_RE)) {
    const key = match[1].trim().toLowerCase();
    attrs[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attrs;
}

function normalizeSensitiveIncludes(values: string | string[] | undefined) {
  const rawValues = Array.isArray(values) ? values : values ? [values] : [];
  return Array.from(
    new Set(
      rawValues
        .flatMap((value) => value.split(/[,\s]+/))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

type RedactionAttributes = {
  fallback?: string;
  sensitiveIncludes: string[];
};

function parseRedactionAttributes(
  raw: string | undefined,
  label: string | undefined,
): RedactionAttributes {
  const attrs = parseAttributes(raw);
  return {
    fallback: attrs.fallback ?? attrs.label ?? label,
    sensitiveIncludes: normalizeSensitiveIncludes(
      attrs["sensitive-include"] ?? attrs.sensitiveinclude,
    ),
  };
}

function parseBlockRedactionAttributes(raw: string | undefined) {
  const source = raw ?? "";
  const labelMatch = source.match(/\[(.*?)\]/);
  const label = labelMatch?.[1]?.trim();
  const attrSource = labelMatch
    ? `${source.slice(0, labelMatch.index)} ${source.slice(
        (labelMatch.index ?? 0) + labelMatch[0].length,
      )}`
    : source;

  return parseRedactionAttributes(attrSource, label);
}

function canRevealSensitiveRedaction(
  requiredIncludes: string[],
  grantedIncludes: Set<string>,
) {
  return (
    requiredIncludes.length > 0 &&
    requiredIncludes.some((include) => grantedIncludes.has(include))
  );
}

function applyFallbackRedactions(
  markdown: string,
  patterns: PiiPattern[],
): string {
  return patterns.reduce(
    (output, { pattern, replacement }) => output.replace(pattern, replacement),
    markdown
  );
}

function preserveMarkdownLinkDestinations(
  markdown: string,
  transform: (content: string) => string,
): string {
  const destinations: string[] = [];
  const stash = (destination: string) => {
    const token = `__ONCOBASE_LINK_DEST_${destinations.length}__`;
    destinations.push(destination);
    return token;
  };

  const protectedMarkdown = markdown
    .replace(
      /^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|[^ \t\n]+)([^\n]*)$/gm,
      (_match, prefix: string, destination: string, suffix: string) =>
        `${prefix}${stash(destination)}${suffix}`,
    )
    .replace(
      /(!?\[[^\]\n]+\]\()([^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\))/g,
      (_match, prefix: string, destination: string, suffix: string) =>
        `${prefix}${stash(destination)}${suffix}`,
    );

  const transformed = transform(protectedMarkdown);

  return destinations.reduce(
    (output, destination, index) =>
      output.replaceAll(`__ONCOBASE_LINK_DEST_${index}__`, destination),
    transformed,
  );
}

export function applyPiiRedactions(
  markdown: string,
  {
    mode = "redacted",
    patterns,
    sensitiveIncludes,
  }: ApplyPiiRedactionsOptions = {}
): string {
  // When no explicit patterns are provided, fall back to the Diana
  // hardcoded list — preserves single-tenant behavior. Multi-site
  // callers should pass `patterns: parseSitePiiPatterns(site.config.piiPatterns)`
  // (which yields `[]` for sites without any configured patterns,
  // disabling the fallback entirely for them).
  const effectivePatterns = patterns ?? DIANA_FALLBACK_REPLACEMENTS;
  const grantedSensitiveIncludes = new Set(
    normalizeSensitiveIncludes(sensitiveIncludes),
  );
  const redact = (
    content: string,
    attrs: RedactionAttributes,
    isBlock: boolean,
  ) => {
    if (
      mode === "revealed" ||
      canRevealSensitiveRedaction(attrs.sensitiveIncludes, grantedSensitiveIncludes)
    ) {
      return content;
    }

    return normalizeReplacement(attrs.fallback ?? "", isBlock);
  };

  const withoutBlocks = markdown.replace(
    BLOCK_REDACTION_RE,
    (_match, attrs: string | undefined, content: string) =>
      redact(content, parseBlockRedactionAttributes(attrs), true)
  );

  const withoutInline = withoutBlocks.replace(
    INLINE_REDACTION_RE,
    (
      _match,
      attrs: string | undefined,
      content: string
    ) => redact(content, parseRedactionAttributes(attrs, undefined), false)
  );

  const withFallbacks =
    mode === "redacted"
      ? preserveMarkdownLinkDestinations(withoutInline, (content) =>
          applyFallbackRedactions(content, effectivePatterns)
        )
      : withoutInline;

  return normalizeMarkdownWhitespace(withFallbacks);
}

export function shouldShowPii(
  value: string | string[] | undefined
): boolean {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    return false;
  }

  return TRUTHY_VALUES.has(normalized.toLowerCase());
}
