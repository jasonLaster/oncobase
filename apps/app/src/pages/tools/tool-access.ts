import { readerQuery, useReaderQuery } from "../../bootstrap/reader-queries";
import type { PageIndexRow } from "../../types";
import { useWikiIdentityPending } from "../../wiki-context";

export type PageAccess = "pending" | "allowed" | "denied";

/**
 * Whether this reader may open a page-owned data set. Data files (JSON) are
 * not listed in the reader manifest, so the check is on the sensitive page
 * that owns them: the server lists a sensitive page only for roles that can
 * read it, and `/api/file` serves an owned asset only to readers who can read
 * every owner. With one owner the two decisions are the same. A missing row
 * reads as "denied" whether the data is restricted or unpublished, so the UI
 * never reveals which; the server stays the authority either way.
 */
export function pageAccess(row: Pick<PageIndexRow, "slug"> | null | undefined, identityPending: boolean): PageAccess {
  if (row) return "allowed";
  return identityPending ? "pending" : "denied";
}

export function usePageAccess(slug: string): PageAccess {
  const row = useReaderQuery(readerQuery.pageIndexBySlug(slug), null) as PageIndexRow | null;
  return pageAccess(row, useWikiIdentityPending());
}
