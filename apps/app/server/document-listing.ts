import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// Corpus-wide document listings, paged by the server over bounded Convex
// queries. Replaces the documents.list/getByTag/listTags actions, which
// fanned out runAction -> runQuery over the whole corpus inside Convex.
type QueryClient = Pick<ConvexHttpClient, "query">;
type Scope = { siteSlug?: string; includeSensitive?: boolean };
type Page<Row> = { page: Row[]; isDone: boolean; continueCursor: string };

const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

async function collectPages<Row>(readPage: (cursor: string | null, numItems: number) => Promise<Page<Row>>, pageSize = PAGE_SIZE): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const result = await readPage(cursor, pageSize);
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
  throw new Error("Document listing did not finish");
}

/** Every readable document's listing metadata (no bodies). */
export function listDocuments(client: QueryClient, args: Scope, pageSize?: number) {
  return collectPages((cursor, numItems) => client.query(api.documents.listPage, { ...args, cursor, numItems }), pageSize);
}

/** Readable documents tagged `tag`, sorted by title. */
export async function getDocumentsByTag(client: QueryClient, args: Scope & { tag: string }, pageSize?: number) {
  const pages = await collectPages((cursor, numItems) => client.query(api.documents.listByTagPage, { ...args, cursor, numItems }), pageSize);
  return pages.sort((a, b) => a.title.localeCompare(b.title));
}

/** Sorted distinct tags across readable documents. */
export async function listDocumentTags(client: QueryClient, args: Scope, pageSize?: number) {
  const pages = await listDocuments(client, args, pageSize);
  return Array.from(new Set(pages.flatMap((page) => page.tags))).sort();
}
