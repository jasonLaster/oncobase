// Bounded, batched slug lookups for request handlers. Per-slug Convex reads
// (`documents:getBySlug`, `access:canUserAccessSlug`) fan out to hundreds of
// RPCs per request and ship full bodies just to read one flag; these helpers
// collapse them into a few chunked calls with limited concurrency.
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { withSiteSlug, type SessionUser } from "./reader-access";

/** Matches `getSensitivityBySlugs`' and `filterAccessibleSlugs`' per-call cap. */
export const SLUG_BATCH_SIZE = 100;
export const SLUG_BATCH_CONCURRENCY = 4;

/** Run `fn` over fixed-size chunks of `items`, at most `concurrency` at once. */
export async function mapChunks<T, R>(
  items: readonly T[],
  fn: (chunk: T[]) => Promise<R[]>,
  { size = SLUG_BATCH_SIZE, concurrency = SLUG_BATCH_CONCURRENCY } = {},
): Promise<R[]> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  const results: R[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      results[index] = await fn(chunks[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return results.flat();
}

/** Slug -> sensitive for existing, non-deleted documents. Absent slugs have
 * no document (the same case where `getBySlug` returns null). */
export async function fetchSlugSensitivity(
  client: ConvexHttpClient,
  siteSlug: string,
  slugs: Iterable<string>,
): Promise<Map<string, boolean>> {
  const unique = [...new Set(slugs)];
  const rows = await mapChunks(unique, chunk =>
    client.query(api.documents.getSensitivityBySlugs, withSiteSlug(siteSlug, { slugs: chunk })));
  return new Map(rows.map(row => [row.slug, row.sensitive]));
}

/** Set of slugs the user may read, via the batched access policy. Anonymous
 * users can read none, matching `canUserAccessSlug`. */
export async function fetchAccessibleSlugs(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  slugs: Iterable<string>,
): Promise<Set<string>> {
  const unique = [...new Set(slugs)];
  if (!user || unique.length === 0) return new Set();
  const rows = await mapChunks(unique, chunk => client.query(
    api.access.filterAccessibleSlugs,
    withSiteSlug(siteSlug, { userId: user._id as Id<"users">, slugs: chunk }),
  ));
  return new Set(rows.filter(row => row.allowed).map(row => row.slug));
}
