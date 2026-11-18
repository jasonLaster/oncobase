import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { fetchRecommendedSlugs, recommendCandidates } from "../shell/palette-recommend";
import type { PageIndexRow } from "../types";
import type { FoundPage } from "./page-conversation";

const FIND_TIMEOUT_MS = 6_000;
/** Words a spoken request wraps around a page's name ("take me back to the X page"). */
const FILLER = new Set(["the", "a", "an", "my", "our", "page", "pages", "to", "back", "open", "go", "show", "me", "take", "please", "one", "doc", "document", "note", "notes"]);
const nameWords = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word && !FILLER.has(word) && !/^\d+$/.test(word));
const sameWords = (a: string[], b: string[]) => {
  const words = new Set(b);
  return a.length > 0 && a.length === b.length && a.every(word => words.has(word));
};

/** Pages whose title or file name says exactly what the reader asked for. Jev
 * scores a page's sub-pages above the page itself ("adjuvant planning" picked
 * a drug page under 2026-11-adjuvant-planning), so a name match wins outright. */
export function pagesNamed(pages: PageIndexRow[], request: string) {
  const wanted = nameWords(request);
  return pages.filter(page => sameWords(nameWords(page.slug.split("/").at(-1) ?? ""), wanted) || sameWords(nameWords(page.title), wanted));
}

/** open_page: the page the reader named out loud. This is the file palette's
 * Jev step: candidates come from the reader's own page index, and the server
 * asks Jev which fits (server/api/palette-recommend.ts). One page named exactly
 * as asked opens without asking Jev; otherwise Jev's first pick is opened, and
 * when it picks none, a few candidates go back as suggestions. */
export async function findTalkPage(pages: PageIndexRow[], request: string, scope: "public" | "session"): Promise<FoundPage> {
  const titles = new Map(pages.map(page => [page.slug, page.title]));
  const title = (slug: string) => titles.get(slug) || formatFileLabel(slug.split("/").at(-1) ?? slug);
  const named = pagesNamed(pages, request);
  if (named.length === 1) return { page: { slug: named[0]!.slug, title: title(named[0]!.slug) } };
  const candidates = recommendCandidates(pages, request);
  if (!candidates.length) return { page: null };
  const slugs = await fetchRecommendedSlugs(request, candidates, scope, AbortSignal.timeout(FIND_TIMEOUT_MS)).catch(() => []);
  const [best, ...rest] = slugs;
  if (!best) return { page: null, suggestions: candidates.slice(0, 3).map(page => page.title || title(page.slug)) };
  return { page: { slug: best, title: title(best) }, alternatives: rest.slice(0, 2).map(title) };
}
