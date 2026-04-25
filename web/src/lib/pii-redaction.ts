export const SHOW_PII_QUERY_PARAM = "showPII";

export type PiiRedactionMode = "redacted" | "revealed";

interface ApplyPiiRedactionsOptions {
  mode?: PiiRedactionMode;
}

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

const BLOCK_REDACTION_RE =
  /^[\t ]*:::redact(?:\[(.*?)\])?[\t ]*\r?\n([\s\S]*?)^[\t ]*:::[\t ]*$/gm;

const INLINE_REDACTION_RE =
  /<redact(?:\s+label=(?:"([^"]*)"|'([^']*)'))?\s*>([\s\S]*?)<\/redact>/gi;

const FALLBACK_REPLACEMENTS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
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
  { pattern: /\bDiana's\b/gi, replacement: "the patient's" },
  {
    pattern: /\bDiana\b(?!\s+(?:Pechter|L\b))/gi,
    replacement: "the patient",
  },
  { pattern: /\b88855655\b/g, replacement: "[redacted MRN]" },
  { pattern: /\b12\/11\/1989\b/g, replacement: "[redacted DOB]" },
  { pattern: /\b11-Dec-1989\b/g, replacement: "[redacted DOB]" },
];

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

function applyFallbackRedactions(markdown: string): string {
  return FALLBACK_REPLACEMENTS.reduce(
    (output, { pattern, replacement }) => output.replace(pattern, replacement),
    markdown
  );
}

export function applyPiiRedactions(
  markdown: string,
  { mode = "redacted" }: ApplyPiiRedactionsOptions = {}
): string {
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
    mode === "redacted" ? applyFallbackRedactions(withoutInline) : withoutInline;

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
