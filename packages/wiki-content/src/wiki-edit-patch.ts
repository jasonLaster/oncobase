import { applyPiiRedactions, findRedactionSpans, type PiiPattern } from "./pii.ts";
import {
  extractAssetAndEmbedReferences,
  findFirstH1,
  isExcludedVaultPath,
  parseMarkdownDocument,
  splitFrontmatter,
  type ParsedMarkdownDocument,
} from "./markdown-document.ts";

export type WikiTextEdit = {
  oldText: string;
  newText: string;
};

export type WikiEditDiffStats = {
  additions: number;
  deletions: number;
};

export type ValidatedWikiEditResult =
  | {
      ok: true;
      proposedRaw: string;
      parsedBase: ParsedMarkdownDocument;
      parsedProposed: ParsedMarkdownDocument;
      redactedProposedBody: string;
      redactedDiff: string;
      stats: WikiEditDiffStats;
      firstChangedHeading: string | null;
    }
  | {
      ok: false;
      code:
        | "invalid_edits"
        | "match_not_found"
        | "match_ambiguous"
        | "overlapping_edits"
        | "redaction_violation"
        | "h1_or_title_changed"
        | "references_changed";
      error: string;
    };

export type ValidatedNewWikiPageResult =
  | {
      ok: true;
      slug: string;
      filePath: string;
      proposedRaw: string;
      parsedProposed: ParsedMarkdownDocument;
      redactedProposedBody: string;
      redactedDiff: string;
      stats: WikiEditDiffStats;
      firstChangedHeading: string | null;
    }
  | {
      ok: false;
      code:
        | "invalid_slug"
        | "invalid_title"
        | "invalid_tags"
        | "invalid_body"
        | "redaction_violation"
        | "references_changed";
      error: string;
    };

const MAX_EDITS_PER_PROPOSAL = 20;
const REDACTION_TAG_RE = /(?:^[\t ]*:::redact(?=$|[\s[\]{])|<\/?redact\b)/im;

function redactionSpansEqual(before: string, after: string): boolean {
  const beforeSpans = findRedactionSpans(before);
  const afterSpans = findRedactionSpans(after);
  if (beforeSpans.length !== afterSpans.length) return false;
  return beforeSpans.every(
    (span, index) =>
      span.kind === afterSpans[index]!.kind && span.raw === afterSpans[index]!.raw,
  );
}

function normalizeWhitespace(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  if (!needle) return positions;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    positions.push(idx);
    from = idx + 1;
  }
  return positions;
}

type SpanReplacement = {
  start: number;
  end: number;
  newText: string;
};

function applySpanReplacements(source: string, spans: SpanReplacement[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const span of sorted) {
    out += source.slice(cursor, span.start) + span.newText;
    cursor = span.end;
  }
  out += source.slice(cursor);
  return out;
}

function hasOverlappingSpans(spans: SpanReplacement[]): boolean {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return true;
  }
  return false;
}

type DiffOp = { kind: "equal" | "del" | "add"; line: string };

/**
 * Myers/LCS line diff producing a compact unified diff with 3 lines of context.
 */
export function buildUnifiedDiff(
  before: string,
  after: string,
  contextLines = 3,
): { diff: string; stats: WikiEditDiffStats } {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");

  // Trim identical prefix & suffix so LCS stays small even on large pages.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const ops: DiffOp[] = [];
  for (let i = 0; i < prefix; i++) ops.push({ kind: "equal", line: a[i]! });

  if (aMid.length * bMid.length <= 2_000_000) {
    const n = aMid.length;
    const m = bMid.length;
    const dp = new Int32Array((n + 1) * (m + 1));
    const width = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * width + j] =
          aMid[i] === bMid[j]
            ? dp[(i + 1) * width + (j + 1)]! + 1
            : Math.max(dp[(i + 1) * width + j]!, dp[i * width + (j + 1)]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (aMid[i] === bMid[j]) {
        ops.push({ kind: "equal", line: aMid[i]! });
        i++;
        j++;
      } else if (dp[(i + 1) * width + j]! >= dp[i * width + (j + 1)]!) {
        ops.push({ kind: "del", line: aMid[i]! });
        i++;
      } else {
        ops.push({ kind: "add", line: bMid[j]! });
        j++;
      }
    }
    while (i < n) ops.push({ kind: "del", line: aMid[i++]! });
    while (j < m) ops.push({ kind: "add", line: bMid[j++]! });
  } else {
    for (const line of aMid) ops.push({ kind: "del", line });
    for (const line of bMid) ops.push({ kind: "add", line });
  }

  for (let i = a.length - suffix; i < a.length; i++) ops.push({ kind: "equal", line: a[i]! });

  let additions = 0;
  let deletions = 0;
  const changedIndexes: number[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    const kind = ops[idx]!.kind;
    if (kind === "add") {
      additions++;
      changedIndexes.push(idx);
    } else if (kind === "del") {
      deletions++;
      changedIndexes.push(idx);
    }
  }
  if (changedIndexes.length === 0) {
    return { diff: "", stats: { additions: 0, deletions: 0 } };
  }

  // Group changed indexes into hunks separated by more than 2 * contextLines.
  const hunks: Array<{ start: number; end: number }> = [];
  for (const idx of changedIndexes) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const prev = hunks[hunks.length - 1];
    if (prev && start <= prev.end + 1) {
      prev.end = Math.max(prev.end, end);
    } else {
      hunks.push({ start, end });
    }
  }

  const lines: string[] = [];
  for (const hunk of hunks) {
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < hunk.start; k++) {
      if (ops[k]!.kind !== "add") oldStart++;
      if (ops[k]!.kind !== "del") newStart++;
    }
    let oldCount = 0;
    let newCount = 0;
    const hunkLines: string[] = [];
    for (let k = hunk.start; k <= hunk.end; k++) {
      const op = ops[k]!;
      if (op.kind === "equal") {
        oldCount++;
        newCount++;
        hunkLines.push(` ${op.line}`);
      } else if (op.kind === "del") {
        oldCount++;
        hunkLines.push(`-${op.line}`);
      } else {
        newCount++;
        hunkLines.push(`+${op.line}`);
      }
    }
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...hunkLines);
  }

  return { diff: lines.join("\n"), stats: { additions, deletions } };
}

/**
 * Apply and validate body-only search/replace edits against a raw vault Markdown file.
 *
 * Security & consistency invariants enforced:
 * 1. Frontmatter is split off verbatim and re-attached untouched (read-only in v1).
 * 2. Every `oldText` must match uniquely against both the redacted view and the raw body,
 *    with no overlapping spans.
 * 3. Redaction-commute invariant: `redact(applyEdit(rawBody)) === normalize(applyEdit(redact(rawBody)))`
 *    (checked both with default redaction and with each document `sensitiveInclude`), plus
 *    `newText` cannot introduce PII or redaction directives (`:::redact` / `<redact>`).
 * 4. First `# ` H1 line index, text, and parsed document title must not change.
 * 5. Local asset / embed references (`extractAssetAndEmbedReferences`) must not change.
 */
export function applyValidatedWikiEdit({
  slug,
  baseRaw,
  edits,
  piiPatterns,
}: {
  slug: string;
  baseRaw: string;
  edits: WikiTextEdit[];
  piiPatterns: PiiPattern[] | undefined;
}): ValidatedWikiEditResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, code: "invalid_edits", error: "Provide at least one edit." };
  }
  if (edits.length > MAX_EDITS_PER_PROPOSAL) {
    return {
      ok: false,
      code: "invalid_edits",
      error: `At most ${MAX_EDITS_PER_PROPOSAL} edits are allowed per proposal.`,
    };
  }

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (!edit.oldText) {
      return { ok: false, code: "invalid_edits", error: `Edit #${i + 1} has empty oldText.` };
    }
    if (edit.oldText === edit.newText) {
      return {
        ok: false,
        code: "invalid_edits",
        error: `Edit #${i + 1} makes no change (oldText equals newText).`,
      };
    }
    if (REDACTION_TAG_RE.test(edit.oldText) || REDACTION_TAG_RE.test(edit.newText)) {
      return {
        ok: false,
        code: "redaction_violation",
        error: `Edit #${i + 1} cannot touch or introduce redaction directives.`,
      };
    }
  }

  const { frontmatterBlock, body: rawBody } = splitFrontmatter(baseRaw);
  const parsedBase = parseMarkdownDocument(slug, baseRaw);
  const redact = (text: string, sensitiveIncludes?: string[]) =>
    applyPiiRedactions(text, { patterns: piiPatterns, sensitiveIncludes });

  const redactedBaseBody = redact(rawBody);
  const rawSpans: SpanReplacement[] = [];
  const redactedSpans: SpanReplacement[] = [];

  for (let i = 0; i < edits.length; i++) {
    const { oldText, newText } = edits[i]!;

    const redactedMatches = findAllOccurrences(redactedBaseBody, oldText);
    if (redactedMatches.length === 0) {
      return {
        ok: false,
        code: "match_not_found",
        error: `Edit #${i + 1}: oldText was not found in the page body. Read the exact section first and copy the text verbatim.`,
      };
    }
    if (redactedMatches.length > 1) {
      return {
        ok: false,
        code: "match_ambiguous",
        error: `Edit #${i + 1}: oldText matched ${redactedMatches.length} times; include more surrounding context so it matches uniquely.`,
      };
    }

    const rawMatches = findAllOccurrences(rawBody, oldText);
    if (rawMatches.length === 0) {
      return {
        ok: false,
        code: "redaction_violation",
        error: `Edit #${i + 1}: target region overlaps redacted content and cannot be edited from Chat.`,
      };
    }
    if (rawMatches.length > 1) {
      return {
        ok: false,
        code: "match_ambiguous",
        error: `Edit #${i + 1}: oldText matched ${rawMatches.length} times in the source; include more surrounding context.`,
      };
    }

    // Verify neither matched span nor replacement text triggers PII redaction.
    if (redact(oldText) !== normalizeWhitespace(oldText)) {
      return {
        ok: false,
        code: "redaction_violation",
        error: `Edit #${i + 1}: target region contains redacted text and cannot be edited from Chat.`,
      };
    }
    if (redact(newText) !== normalizeWhitespace(newText)) {
      return {
        ok: false,
        code: "redaction_violation",
        error: `Edit #${i + 1}: replacement text contains content that triggers site PII redaction rules.`,
      };
    }

    rawSpans.push({ start: rawMatches[0]!, end: rawMatches[0]! + oldText.length, newText });
    redactedSpans.push({
      start: redactedMatches[0]!,
      end: redactedMatches[0]! + oldText.length,
      newText,
    });
  }

  if (hasOverlappingSpans(rawSpans) || hasOverlappingSpans(redactedSpans)) {
    return {
      ok: false,
      code: "overlapping_edits",
      error: "Edits must target non-overlapping regions of the original page.",
    };
  }

  const proposedBody = applySpanReplacements(rawBody, rawSpans);
  if (!redactionSpansEqual(rawBody, proposedBody)) {
    return {
      ok: false,
      code: "redaction_violation",
      error: "Edit modifies or alters the boundaries of a redacted span.",
    };
  }
  const redactedFromRaw = redact(proposedBody);
  const redactedFromEditedView = normalizeWhitespace(
    applySpanReplacements(redactedBaseBody, redactedSpans),
  );

  // Core redaction-commute invariant.
  if (redactedFromRaw !== redactedFromEditedView) {
    return {
      ok: false,
      code: "redaction_violation",
      error: "Edit does not commute with site PII redaction rules (it may touch a redacted span or introduce PII).",
    };
  }

  // Also verify commute under any document-level sensitive-include scopes.
  const sensitiveModes: string[][] = [
    ...parsedBase.sensitiveInclude.map((item) => [item]),
    ...(parsedBase.sensitiveInclude.length > 1 ? [parsedBase.sensitiveInclude] : []),
  ];
  for (const includes of sensitiveModes) {
    const scopedBase = redact(rawBody, includes);
    const scopedSpans: SpanReplacement[] = [];
    for (const { oldText, newText } of edits) {
      const hits = findAllOccurrences(scopedBase, oldText);
      if (hits.length !== 1) {
        return {
          ok: false,
          code: "redaction_violation",
          error: "Edit overlaps a conditionally visible sensitive-include region and cannot be applied from Chat.",
        };
      }
      scopedSpans.push({ start: hits[0]!, end: hits[0]! + oldText.length, newText });
    }
    const scopedProposed = redact(proposedBody, includes);
    const scopedFromView = normalizeWhitespace(applySpanReplacements(scopedBase, scopedSpans));
    if (scopedProposed !== scopedFromView) {
      return {
        ok: false,
        code: "redaction_violation",
        error: "Edit does not commute with document sensitive-include visibility rules.",
      };
    }
  }

  const proposedRaw = `${frontmatterBlock}${proposedBody}`;
  const baseH1 = findFirstH1(rawBody);
  const proposedH1 = findFirstH1(proposedBody);
  const parsedProposed = parseMarkdownDocument(slug, proposedRaw);

  if (
    parsedBase.title !== parsedProposed.title ||
    (baseH1?.text ?? null) !== (proposedH1?.text ?? null) ||
    (baseH1?.lineIndex ?? null) !== (proposedH1?.lineIndex ?? null)
  ) {
    return {
      ok: false,
      code: "h1_or_title_changed",
      error: "Edits cannot add, remove, move, or modify the page's primary H1 heading or title.",
    };
  }

  const baseRefs = extractAssetAndEmbedReferences(rawBody);
  const proposedRefs = extractAssetAndEmbedReferences(proposedBody);
  if (
    baseRefs.length !== proposedRefs.length ||
    baseRefs.some((ref, idx) => ref !== proposedRefs[idx])
  ) {
    return {
      ok: false,
      code: "references_changed",
      error: "Edits cannot add, remove, or change local asset or embed references (images, PDFs, or transclusions).",
    };
  }

  const { diff, stats } = buildUnifiedDiff(redactedBaseBody, redactedFromRaw);
  return {
    ok: true,
    proposedRaw,
    parsedBase,
    parsedProposed,
    redactedProposedBody: redactedFromRaw,
    redactedDiff: diff,
    stats,
    firstChangedHeading: findFirstChangedHeading(redactedFromRaw, diff),
  };
}

/**
 * Find the nearest Markdown heading covering the first changed/added line in a
 * unified diff so the Preview pane can scroll straight to the edited section.
 */
export function findFirstChangedHeading(
  redactedBody: string,
  redactedDiff: string,
): string | null {
  if (!redactedBody || !redactedDiff) return null;
  const diffLines = redactedDiff.split("\n");
  let newLine = 0;
  let firstChangedLine: number | null = null;
  for (const line of diffLines) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      firstChangedLine = newLine;
      break;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      firstChangedLine = Math.max(1, newLine);
      break;
    }
    if (line.startsWith(" ")) {
      newLine++;
    }
  }
  if (firstChangedLine === null) return null;

  const bodyLines = redactedBody.replace(/\r\n/g, "\n").split("\n");
  const targetIdx = Math.min(Math.max(0, firstChangedLine - 1), bodyLines.length - 1);

  // If the changed region itself introduces a heading within a few lines, prefer it.
  for (let i = targetIdx; i < Math.min(bodyLines.length, targetIdx + 4); i++) {
    const m = bodyLines[i]!.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (m?.[1]) return m[1].trim();
  }
  // Otherwise walk upward to the enclosing section heading.
  for (let i = targetIdx; i >= 0; i--) {
    const m = bodyLines[i]!.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Apply validated search/replace edits onto an already-redacted Convex page body
 * to compute the exact Preview body without storing full page text in proposal rows.
 */
export function computeRedactedPreview({
  baseRedactedBody,
  edits,
  redactedDiff,
}: {
  baseRedactedBody: string;
  edits: WikiTextEdit[];
  redactedDiff?: string;
}): { redactedProposedBody: string; firstChangedHeading: string | null } | null {
  if (!edits.length) {
    return {
      redactedProposedBody: baseRedactedBody,
      firstChangedHeading: redactedDiff
        ? findFirstChangedHeading(baseRedactedBody, redactedDiff)
        : null,
    };
  }
  const spans: SpanReplacement[] = [];
  for (const edit of edits) {
    const matches = findAllOccurrences(baseRedactedBody, edit.oldText);
    if (matches.length !== 1) return null;
    spans.push({
      start: matches[0]!,
      end: matches[0]! + edit.oldText.length,
      newText: edit.newText,
    });
  }
  if (hasOverlappingSpans(spans)) return null;
  const proposed = normalizeWhitespace(applySpanReplacements(baseRedactedBody, spans));
  const diff = redactedDiff ?? buildUnifiedDiff(baseRedactedBody, proposed).diff;
  return {
    redactedProposedBody: proposed,
    firstChangedHeading: findFirstChangedHeading(proposed, diff),
  };
}

const RESERVED_CREATE_TAGS = new Set(["sensitive", "echo-sensitive", "serova-sensitive"]);
const MAX_NEW_PAGE_TAGS = 12;
const MAX_NEW_PAGE_BODY_CHARS = 80_000;

function yamlQuoteString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Validate and serialize a brand-new wiki page proposed from Chat.
 *
 * Security invariants:
 * - Slug must be a clean, non-excluded vault path (always writes `<slug>.md`).
 * - Frontmatter is synthesized exclusively by the server (never arbitrary YAML).
 * - `sensitive` defaults to `true` (fail-closed) unless explicitly set to `false`.
 * - Title and body must not contain redaction directives, PII patterns, or local
 *   asset/embed references.
 */
export function validateNewWikiPage({
  slug,
  title,
  tags,
  sensitive = true,
  body,
  piiPatterns,
  ignoreMatchers = [],
}: {
  slug: string;
  title: string;
  tags?: string[];
  sensitive?: boolean;
  body: string;
  piiPatterns: PiiPattern[] | undefined;
  ignoreMatchers?: readonly RegExp[];
}): ValidatedNewWikiPageResult {
  const cleanSlug = slug.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleanSlug || /\.(?:md|mdx)$/i.test(cleanSlug) || cleanSlug.includes("\\") || cleanSlug.includes("..")) {
    return {
      ok: false,
      code: "invalid_slug",
      error: "New page slug must be a clean relative path without .md extension or traversal segments.",
    };
  }
  const segments = cleanSlug.split("/");
  if (
    segments.some(
      (seg) =>
        !seg ||
        seg.length > 100 ||
        seg.startsWith(".") ||
        seg.startsWith(" ") ||
        seg.endsWith(" ") ||
        !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(seg),
    )
  ) {
    return {
      ok: false,
      code: "invalid_slug",
      error: `Invalid slug "${cleanSlug}". Use letters, numbers, hyphens, underscores, or spaces in path segments.`,
    };
  }
  const filePath = `${cleanSlug}.md`;
  if (isExcludedVaultPath(filePath, ignoreMatchers)) {
    return {
      ok: false,
      code: "invalid_slug",
      error: `Path "${filePath}" is in an excluded directory or matched by .oncobaseignore.`,
    };
  }

  const cleanTitle = title.replace(/\r?\n/g, " ").trim();
  if (!cleanTitle || cleanTitle.length > 200) {
    return {
      ok: false,
      code: "invalid_title",
      error: "New page title is required and must be 1–200 characters.",
    };
  }
  const redact = (text: string) => applyPiiRedactions(text, { patterns: piiPatterns });
  if (REDACTION_TAG_RE.test(cleanTitle) || redact(cleanTitle) !== normalizeWhitespace(cleanTitle)) {
    return {
      ok: false,
      code: "redaction_violation",
      error: "New page title contains restricted redaction markup or PII.",
    };
  }

  const cleanTags: string[] = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > MAX_NEW_PAGE_TAGS) {
      return {
        ok: false,
        code: "invalid_tags",
        error: `At most ${MAX_NEW_PAGE_TAGS} tags are allowed on a new page.`,
      };
    }
    const seen = new Set<string>();
    for (const rawTag of tags) {
      const tag = String(rawTag).trim();
      if (!tag || tag.length > 40 || /[\r\n]/.test(tag) || !/^[A-Za-z0-9][A-Za-z0-9 _/-]*$/.test(tag)) {
        return {
          ok: false,
          code: "invalid_tags",
          error: `Invalid tag "${tag}".`,
        };
      }
      const lower = tag.toLowerCase();
      if (RESERVED_CREATE_TAGS.has(lower)) {
        return {
          ok: false,
          code: "invalid_tags",
          error: `Tag "${tag}" is reserved; control visibility with the sensitive boolean instead.`,
        };
      }
      if (!seen.has(lower)) {
        seen.add(lower);
        cleanTags.push(tag);
      }
    }
  }

  const normalizedInputBody = body.replace(/\r\n/g, "\n").trim();
  if (!normalizedInputBody || normalizedInputBody.length > MAX_NEW_PAGE_BODY_CHARS) {
    return {
      ok: false,
      code: "invalid_body",
      error: `New page body is required and must be under ${MAX_NEW_PAGE_BODY_CHARS} characters.`,
    };
  }
  if (/^---[ \t]*(?:\n|$)/.test(normalizedInputBody)) {
    return {
      ok: false,
      code: "invalid_body",
      error: "Do not include YAML frontmatter in body; pass title, tags, and sensitive as fields.",
    };
  }
  if (REDACTION_TAG_RE.test(normalizedInputBody)) {
    return {
      ok: false,
      code: "redaction_violation",
      error: "New page body cannot include redaction directives.",
    };
  }
  if (redact(normalizedInputBody) !== normalizeWhitespace(normalizedInputBody)) {
    return {
      ok: false,
      code: "redaction_violation",
      error: "New page body contains content that triggers site PII redaction rules.",
    };
  }
  const refs = extractAssetAndEmbedReferences(normalizedInputBody);
  if (refs.length > 0) {
    return {
      ok: false,
      code: "references_changed",
      error: "New pages cannot embed local assets (images, PDFs, or transclusions) from Chat.",
    };
  }

  // Strip a duplicate leading `# <title>` H1 if the model included it; reject a conflicting H1.
  let bodyContent = normalizedInputBody;
  const existingH1 = findFirstH1(bodyContent);
  if (existingH1) {
    if (existingH1.lineIndex === 0 && existingH1.heading.trim() === cleanTitle) {
      bodyContent = bodyContent.replace(/^#\s+.+\n*/, "").trim();
    } else {
      return {
        ok: false,
        code: "invalid_body",
        error: "Do not add a separate `# ` H1 heading inside body (it is generated from title); use `##` for sections.",
      };
    }
  }
  if (!bodyContent) {
    return {
      ok: false,
      code: "invalid_body",
      error: "New page body must include content beyond the page title.",
    };
  }

  const fmLines = ["---", `title: ${yamlQuoteString(cleanTitle)}`];
  if (cleanTags.length > 0) {
    fmLines.push(`tags: [${cleanTags.map(yamlQuoteString).join(", ")}]`);
  }
  if (sensitive) {
    fmLines.push("sensitive: true");
  }
  fmLines.push("---", "");

  const rawBodyWithH1 = `# ${cleanTitle}\n\n${bodyContent}\n`;
  const proposedRaw = `${fmLines.join("\n")}\n${rawBodyWithH1}`;
  const parsedProposed = parseMarkdownDocument(cleanSlug, proposedRaw);
  const redactedProposedBody = redact(rawBodyWithH1);
  const { diff, stats } = buildUnifiedDiff("", redactedProposedBody);

  return {
    ok: true,
    slug: cleanSlug,
    filePath,
    proposedRaw,
    parsedProposed,
    redactedProposedBody,
    redactedDiff: diff,
    stats,
    firstChangedHeading: findFirstChangedHeading(redactedProposedBody, diff),
  };
}
