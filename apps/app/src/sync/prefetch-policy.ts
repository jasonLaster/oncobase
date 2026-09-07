export const PREFETCH_LIMITS = { pages: 150, bytes: 8 * 1024 * 1024, pauseMs: 2000, refreshMs: 5 * 60_000, revalidateMs: 30_000 };
export type CachedPage = { slug: string; size: number; fetchedAt: number; contentHash: string | null; contentStatus: string };
type IndexedPage = { slug: string; size: number; contentHash: string | null };

export function canPrefetch({ online, visible, saveData, effectiveType, pressure, inputPending }: {
  online: boolean; visible: boolean; saveData?: boolean; effectiveType?: string; pressure?: number; inputPending?: boolean;
}) {
  return online && visible && !saveData && !inputPending && !["slow-2g", "2g"].includes(effectiveType ?? "") && (pressure ?? 0) < 0.8;
}

export function planPrefetch({ activeSlug, recent, ranked, index, cached }: {
  activeSlug: string; recent: string[]; ranked: string[]; index: readonly IndexedPage[]; cached: CachedPage[];
}) {
  const bySlug = new Map(index.map(page => [page.slug, page]));
  const cache = new Map(cached.map(page => [page.slug, page]));
  const priority = [...new Set([activeSlug, ...recent.slice(0, 20), ...ranked,
    ...[...cached].sort((a, b) => b.fetchedAt - a.fetchedAt).map(page => page.slug)])];
  const keep = new Set<string>();
  const queue: string[] = [];
  let bytes = 0;
  for (const slug of priority) {
    const page = bySlug.get(slug);
    const local = cache.get(slug);
    if (!page && slug !== activeSlug) continue;
    // Manifest sizes historically count UTF-16 units. Reserve worst-case UTF-8
    // bytes for new bodies; persisted bodies use their actual byte length.
    const size = local?.size ?? (page?.size ?? 0) * 3;
    if (slug !== activeSlug && (keep.size >= PREFETCH_LIMITS.pages || bytes + size > PREFETCH_LIMITS.bytes)) continue;
    keep.add(slug);
    bytes += size;
    if (slug !== activeSlug && page && (!local || local.contentStatus === "stale" || (local.contentStatus === "fresh" && local.contentHash !== page.contentHash))) queue.push(slug);
  }
  return { queue, evict: cached.filter(page => !keep.has(page.slug)).map(page => page.slug) };
}
