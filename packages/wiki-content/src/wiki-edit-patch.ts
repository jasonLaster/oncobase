import { applyPiiRedactions, type PiiPattern } from "./pii.ts";
import {
  extractAssetAndEmbedReferences,
  findFirstH1,
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
      redactedDiff: string;
      stats: WikiEditDiffStats;
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

const MAX_EDITS_PER_PROPOSAL = 20;
const REDACTION_MARKUP_RE = /(?:^[\t ]*:::redact\b|^[\t ]*:::[\t ]*$|<\/?redact\b)/im;

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
    if (REDACTION_MARKUP_RE.test(edit.oldText) || REDACTION_MARKUP_RE.test(edit.newText)) {
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
    redactedDiff: diff,
    stats,
  };
}
