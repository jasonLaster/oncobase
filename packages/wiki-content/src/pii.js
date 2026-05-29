export const SHOW_PII_QUERY_PARAM = "showPII";

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

const BLOCK_REDACTION_RE =
  /^[\t ]*:::redact(?:\[(.*?)\])?[\t ]*\r?\n([\s\S]*?)^[\t ]*:::[\t ]*$/gm;

const INLINE_REDACTION_RE =
  /<redact(?:\s+label=(?:"([^"]*)"|'([^']*)'))?\s*>([\s\S]*?)<\/redact>/gi;

const DIANA_FALLBACK_REPLACEMENTS = [
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

export function parseSitePiiPatterns(input) {
  if (!input || input.length === 0) return [];
  const out = [];
  for (const entry of input) {
    try {
      if (entry.trim().startsWith("{")) {
        const obj = JSON.parse(entry);
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
      console.warn(`[pii] pattern compile failed, skipped: ${err.message}`);
    }
  }
  return out;
}

function normalizeReplacement(replacement, isBlock) {
  if (!replacement) {
    return isBlock ? "\n\n" : "";
  }

  return isBlock ? `\n${replacement}\n` : replacement;
}

function normalizeMarkdownWhitespace(markdown) {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyFallbackRedactions(markdown, patterns) {
  return patterns.reduce(
    (output, { pattern, replacement }) => output.replace(pattern, replacement),
    markdown,
  );
}

export function applyPiiRedactions(
  markdown,
  { mode = "redacted", patterns } = {},
) {
  const effectivePatterns = patterns ?? DIANA_FALLBACK_REPLACEMENTS;
  const redact = (content, label, isBlock) => {
    if (mode === "revealed") {
      return content;
    }

    return normalizeReplacement(label ?? "", isBlock);
  };

  const withoutBlocks = markdown.replace(
    BLOCK_REDACTION_RE,
    (_match, label, content) => redact(content, label?.trim(), true),
  );

  const withoutInline = withoutBlocks.replace(
    INLINE_REDACTION_RE,
    (_match, doubleQuotedLabel, singleQuotedLabel, content) =>
      redact(content, doubleQuotedLabel ?? singleQuotedLabel, false),
  );

  const withFallbacks =
    mode === "redacted"
      ? applyFallbackRedactions(withoutInline, effectivePatterns)
      : withoutInline;

  return normalizeMarkdownWhitespace(withFallbacks);
}

export function shouldShowPii(value) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    return false;
  }

  return TRUTHY_VALUES.has(normalized.toLowerCase());
}
