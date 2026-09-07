import { applyPiiRedactions, type PiiPattern } from "@oncobase/wiki-content/pii";

export type SearchablePage = { slug: string; title: string; lines: string[] };

export function redactionConfigurationKey(patterns: PiiPattern[] | undefined) {
  return patterns === undefined ? "diana-defaults" : JSON.stringify(patterns.map(({ pattern, replacement }) => [pattern.source, pattern.flags, replacement]));
}

// Prepare incrementally as each database page arrives. The cache retains only
// searchable, redacted lines rather than both raw and prepared corpus copies.
export function prepareSearchPage(page: { slug: string; title: string; content: string }, patterns: PiiPattern[] | undefined): SearchablePage {
  return {
    slug: page.slug,
    title: applyPiiRedactions(page.title, { patterns }),
    lines: applyPiiRedactions(page.content, { patterns }).split("\n"),
  };
}
