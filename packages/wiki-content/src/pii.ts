export const SHOW_PII_QUERY_PARAM = "showPII";

export type PiiRedactionMode = "redacted" | "revealed";

export type PiiPattern = {
  pattern: RegExp;
  replacement: string;
};

interface ApplyPiiRedactionsOptions {
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
}

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

const BLOCK_REDACTION_RE =
  /^[\t ]*:::redact(?:\[(.*?)\])?[\t ]*\r?\n([\s\S]*?)^[\t ]*:::[\t ]*$/gm;

const INLINE_REDACTION_RE =
  /<redact(?:\s+label=(?:"([^"]*)"|'([^']*)'))?\s*>([\s\S]*?)<\/redact>/gi;

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
  { mode = "redacted", patterns }: ApplyPiiRedactionsOptions = {}
): string {
  // When no explicit patterns are provided, fall back to the Diana
  // hardcoded list — preserves single-tenant behavior. Multi-site
  // callers should pass `patterns: parseSitePiiPatterns(site.config.piiPatterns)`
  // (which yields `[]` for sites without any configured patterns,
  // disabling the fallback entirely for them).
  const effectivePatterns = patterns ?? DIANA_FALLBACK_REPLACEMENTS;
  const redact = (content: string, label: string | undefined, isBlock: boolean) => {
    if (mode === "revealed") {
      return content;
    }

    return normalizeReplacement(label ?? "", isBlock);
  };

  const withoutBlocks = markdown.replace(
    BLOCK_REDACTION_RE,
    (_match, label: string | undefined, content: string) =>
      redact(content, label?.trim(), true)
  );

  const withoutInline = withoutBlocks.replace(
    INLINE_REDACTION_RE,
    (
      _match,
      doubleQuotedLabel: string | undefined,
      singleQuotedLabel: string | undefined,
      content: string
    ) => redact(content, doubleQuotedLabel ?? singleQuotedLabel, false)
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
