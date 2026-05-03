"use server";

import { siteDataFromSlug } from "@/lib/site-data";
import { DEFAULT_SITE_SLUG } from "@/lib/site";
import { applyPiiRedactions } from "@/lib/pii-redaction";

export interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchResult {
  filePath: string;
  slug: string;
  title: string;
  matches: SearchMatch[];
}

// Per-doc line-level grep, sourced from Convex. Apply the same redaction
// pass used for page rendering because older published documents can still
// contain raw identifiers.
export async function searchMarkdown(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];

  const searchTerm = query.trim();
  const regex = new RegExp(escapeRegex(searchTerm), "gi");

  const siteData = siteDataFromSlug(DEFAULT_SITE_SLUG);
  const docs: Array<{ slug: string; title: string; content: string }> = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page = (await siteData.documents.listPageWithContent({
      cursor,
      numItems: 100,
    })) as {
      page: Array<{ slug: string; title: string; content: string }>;
      isDone: boolean;
      continueCursor: string;
    };
    docs.push(...page.page);
    isDone = page.isDone;
    cursor = page.continueCursor;
  }

  const results: SearchResult[] = [];
  for (const doc of docs) {
    if (!doc.content) continue;
    const redactedContent = applyPiiRedactions(doc.content);
    const redactedTitle = applyPiiRedactions(doc.title);
    const lines = redactedContent.split("\n");
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(line)) !== null) {
        matches.push({
          lineNumber: i + 1,
          lineContent: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
        });
        break;
      }
    }

    if (matches.length > 0) {
      results.push({
        filePath: doc.slug,
        slug: doc.slug,
        title: redactedTitle,
        matches,
      });
    }
  }

  results.sort((a, b) => b.matches.length - a.matches.length);
  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
