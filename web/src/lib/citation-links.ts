const REFERENCE_HEADINGS = new Set(["references", "bibliography", "citations"]);
const GENERATED_REFERENCE_ANCHOR_ID = "references";
const GENERATED_REFERENCE_HEADING = `<h2 id="${GENERATED_REFERENCE_ANCHOR_ID}">References</h2>\n\n`;

const REFERENCE_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const REFERENCE_LIST_ITEM_RE = /^(\d+)\.\s+/;
const LATEX_CITATION_RE = /\\cite[a-zA-Z*]*\{([^}]+)\}/g;
const NUMERIC_CITATION_RE = /\[(\d+(?:\s*[-\u2013]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-\u2013]\s*\d+)?)*)\](?!\s*[:(])/g;
const INLINE_SUPERSCRIPT_CITATION_RE =
  /([a-z][a-z0-9'’_-]*)\^\{(\d+(?:\s*(?:,|--|[-\u2013])\s*\d+)*)\}(?![A-Za-z0-9])/g;

type ReferenceTarget = {
  anchorId: string;
  index: number;
  injectedMarkup?: string;
};

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCitationAnchor(display: string, anchorId: string) {
  const safeDisplay = escapeHtml(display);
  const safeAnchorId = escapeHtml(anchorId);
  return `<a href="#${safeAnchorId}" class="citation-ref" data-citation-link="true" aria-label="Jump to citations">${safeDisplay}</a>`;
}

function normalizeNumericCitationLabel(rawLabel: string): string {
  return rawLabel
    .replace(/\s+/g, "")
    .replace(/--/g, "-")
    .replace(/\u2013/g, "-");
}

function replaceLatexCitations(text: string, anchorId: string): string {
  return text.replace(LATEX_CITATION_RE, (_match, rawKeys: string) => {
    const label = rawKeys
      .split(/[,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .join(", ");

    if (!label) {
      return _match;
    }

    return buildCitationAnchor(`[${label}]`, anchorId);
  });
}

function replaceNumericCitations(text: string, anchorId: string): string {
  return text.replace(NUMERIC_CITATION_RE, (match) => buildCitationAnchor(match, anchorId));
}

function replaceInlineSuperscriptCitations(text: string, anchorId: string): string {
  return text.replace(
    INLINE_SUPERSCRIPT_CITATION_RE,
    (_match, prefix: string, rawLabel: string) => {
      const label = normalizeNumericCitationLabel(rawLabel);
      return `${prefix}<sup>${buildCitationAnchor(label, anchorId)}</sup>`;
    }
  );
}

function transformOutsideCodeFences(
  markdown: string,
  transform: (text: string) => string
): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceMarker = "";

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^(```+|~~~+)/);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fenceMatch[1][0];
        } else if (fenceMatch[1][0] === fenceMarker) {
          inFence = false;
          fenceMarker = "";
        }
        return line;
      }

      if (inFence) {
        return line;
      }

      return transform(line);
    })
    .join("\n");
}

function findReferenceHeading(markdown: string): ReferenceTarget | null {
  let offset = 0;

  for (const line of markdown.split("\n")) {
    const match = line.match(REFERENCE_HEADING_RE);
    if (match) {
      const headingText = match[2].trim();
      const anchorId = slugifyHeading(headingText);
      if (REFERENCE_HEADINGS.has(anchorId)) {
        return { anchorId, index: offset };
      }
    }

    offset += line.length + 1;
  }

  return null;
}

function isReferenceSectionBoundary(line: string): boolean {
  return REFERENCE_HEADING_RE.test(line) || /^---\s*$/.test(line);
}

function countSequentialReferenceItems(lines: string[], startIndex: number): number {
  let expectedNumber = 1;
  let count = 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }

    if (count > 0 && isReferenceSectionBoundary(line)) {
      break;
    }

    const numberedItem = line.match(REFERENCE_LIST_ITEM_RE);
    if (numberedItem) {
      const itemNumber = Number(numberedItem[1]);
      if (itemNumber === expectedNumber) {
        count += 1;
        expectedNumber += 1;
        continue;
      }

      break;
    }

    if (count > 0) {
      continue;
    }

    break;
  }

  return count;
}

function findReferenceList(markdown: string): ReferenceTarget | null {
  const lines = markdown.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;

  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let bestMatch: { startIndex: number; count: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(REFERENCE_LIST_ITEM_RE);
    if (!match || match[1] !== "1") {
      continue;
    }

    const count = countSequentialReferenceItems(lines, index);
    if (count < 3) {
      continue;
    }

    if (!bestMatch || count > bestMatch.count) {
      bestMatch = { startIndex: index, count };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    anchorId: GENERATED_REFERENCE_ANCHOR_ID,
    index: lineOffsets[bestMatch.startIndex],
    injectedMarkup: GENERATED_REFERENCE_HEADING,
  };
}

function findReferenceTarget(markdown: string): ReferenceTarget | null {
  return findReferenceHeading(markdown) ?? findReferenceList(markdown);
}

export function preprocessCitationMarkdown(
  markdown: string,
  explicitAnchorId?: string
): string {
  const referenceHeading = explicitAnchorId
    ? { anchorId: explicitAnchorId, index: markdown.length }
    : findReferenceTarget(markdown);

  if (!referenceHeading) {
    return markdown;
  }

  const prefix = markdown.slice(0, referenceHeading.index);
  const suffix = markdown.slice(referenceHeading.index);
  const transformedPrefix = transformOutsideCodeFences(prefix, (line) =>
    replaceInlineSuperscriptCitations(
      replaceNumericCitations(
        replaceLatexCitations(line, referenceHeading.anchorId),
        referenceHeading.anchorId
      ),
      referenceHeading.anchorId
    )
  );

  if (transformedPrefix === prefix) {
    return markdown;
  }

  return transformedPrefix + (referenceHeading.injectedMarkup ?? "") + suffix;
}
