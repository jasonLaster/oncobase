/** Client half of the Jev-recommended pages in the file palette
 * (flag: palette-jev-flag.ts; server: server/api/palette-recommend.ts). */
import { PALETTE_SHORTHAND } from "@oncobase/wiki-shell/file-palette";
import type { PageIndexRow } from "../types";
import { parseJsonArray } from "../wiki-utils";

export const MAX_CANDIDATES = 40;
const STOPWORDS = new Set(["the", "and", "for", "with", "from", "about", "page", "pages", "notes"]);

export type RecommendCandidate = { slug: string; title?: string; tags?: string[]; description?: string | null; rank?: number };

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** Query words of three or more letters (or known shorthand); a partial last word still counts as a prefix. */
const queryTerms = (query: string) => [...new Set(words(query).filter(word => (word.length >= 3 || word in PALETTE_SHORTHAND) && !STOPWORDS.has(word)))];

type Indexed = { row: PageIndexRow; tags: string[]; title: Set<string>; path: Set<string>; tagWords: Set<string>; about: Set<string> };
const indexes = new WeakMap<PageIndexRow[], Indexed[]>();
function indexed(pages: PageIndexRow[]) {
  let index = indexes.get(pages);
  if (!index) {
    index = pages.map(row => {
      const tags = parseJsonArray<unknown>(row.tagsJson).filter((tag): tag is string => typeof tag === "string");
      return {
        row, tags,
        title: new Set(words(row.title)), path: new Set(words(row.slug)),
        tagWords: new Set(tags.flatMap(words)), about: new Set(words(row.description ?? "")),
      };
    });
    indexes.set(pages, index);
  }
  return index;
}
const hits = (set: Set<string>, term: string) => {
  if (set.has(term)) return true;
  const long = PALETTE_SHORTHAND[term];
  for (const word of set) {
    if (word.startsWith(term) || (term.length >= 5 && term.startsWith(word) && word.length >= 4)) return true;
    if (long !== undefined && word.startsWith(long)) return true;
  }
  return false;
};

/** Pages worth asking about: any query word in a title, path, tag or
 * description, weighted by how rare the word is (so "overview" counts for
 * little and "tissue" for a lot), plus the palette's own top fuzzy matches. */
export function recommendCandidates(pages: PageIndexRow[], query: string, fuzzySlugs: string[] = [], limit = MAX_CANDIDATES): RecommendCandidate[] {
  const terms = queryTerms(query);
  const index = indexed(pages);
  const bySlug = new Map(index.map(entry => [entry.row.slug, entry]));
  const weights = new Map(terms.map(term => {
    const count = index.reduce((sum, entry) => sum + (hits(entry.title, term) || hits(entry.path, term) ? 1 : 0), 0);
    return [term, Math.log((index.length + 1) / (count + 1))];
  }));
  const scored = index.flatMap(entry => {
    let score = 0;
    for (const term of terms) {
      const weight = weights.get(term) ?? 0;
      if (hits(entry.title, term)) score += 3 * weight;
      else if (hits(entry.path, term)) score += 2 * weight;
      if (hits(entry.tagWords, term)) score += 1.5 * weight;
      if (hits(entry.about, term)) score += weight;
    }
    return score > 0 ? [{ entry, score }] : [];
  }).sort((a, b) => b.score - a.score);

  const chosen = new Map<string, Indexed>();
  for (const slug of fuzzySlugs.slice(0, 10)) { const entry = bySlug.get(slug); if (entry) chosen.set(slug, entry); }
  for (const { entry } of scored) {
    if (chosen.size >= limit) break;
    // Raw and formatted note siblings are listed under their overview.
    if (/-(raw|formatted)$/.test(entry.row.slug) && bySlug.has(entry.row.slug.replace(/-(raw|formatted)$/, "-overview"))) continue;
    chosen.set(entry.row.slug, entry);
  }
  // Clipped to what the route accepts: one page without a frontmatter title
  // (a poster's long first heading) would otherwise fail the whole request.
  const fuzzyRank = new Map(fuzzySlugs.slice(0, 10).map((slug, position) => [slug, position + 1]));
  return [...chosen.values()].slice(0, limit).map(({ row, tags }) => ({
    slug: row.slug, title: row.title.slice(0, 300), ...(tags.length ? { tags: tags.slice(0, 8).map(tag => tag.slice(0, 80)) } : {}),
    ...(fuzzyRank.has(row.slug) ? { rank: fuzzyRank.get(row.slug) } : {}),
    ...(row.description ? { description: row.description.slice(0, 300) } : {}),
  }));
}

export async function fetchRecommendedSlugs(query: string, candidates: RecommendCandidate[], scope: "public" | "session", signal: AbortSignal) {
  const response = await fetch(`/api/wiki/palette-recommend?scope=${scope}`, {
    method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, candidates }),
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => null) as { results?: Array<{ slug: string }> } | null;
  return (body?.results ?? []).map(result => result.slug);
}

/** Tells the server which page the reader opened for what they typed
 * (server/api/palette-pick.ts). Survives the navigation it precedes, and a
 * pick that fails to record is simply lost. */
export function recordPalettePick(pick: { query: string; slug: string; position: number; recommended: boolean; recommendedSlugs: string[] }, scope: "public" | "session") {
  void fetch(`/api/wiki/palette-pick?scope=${scope}`, {
    method: "POST", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pick),
  }).catch(() => undefined);
}
