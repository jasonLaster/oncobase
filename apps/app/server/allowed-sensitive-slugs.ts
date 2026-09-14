type Page = { page: Array<{ slug: string; sensitive?: boolean }>; isDone: boolean; continueCursor: string | null };
type AccessResult = { slug: string; allowed: boolean };

/** Preserve the exact access-aware cache key, with fewer serial RPCs. Read
 * lightweight metadata, overlap the next page, and bound existing permission
 * checks to four batches of 100. Never cache an authorization decision. */
export async function loadAllowedSensitiveSlugs(
  fetchPage: (cursor: string | null, numItems: number) => Promise<Page>,
  filterSlugs: (slugs: string[]) => Promise<AccessResult[]>,
) {
  let pageSize = 1000;
  const read = async (cursor: string | null) => {
    try { return await fetchPage(cursor, pageSize); }
    catch (error) {
      // Large documents can exceed a backend read budget. Retry the same
      // cursor with the original batch size; a second failure still propagates.
      if (pageSize === 100) throw error;
      pageSize = 100;
      return fetchPage(cursor, pageSize);
    }
  };
  const check = async (slugs: string[]) => {
    const batches = Array.from({ length: Math.ceil(slugs.length / 100) }, (_, index) => slugs.slice(index * 100, index * 100 + 100));
    const results: AccessResult[][] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length) {
        const index = next++;
        results[index] = await filterSlugs(batches[index]!);
      }
    }));
    return results.flat().filter(result => result.allowed).map(result => result.slug);
  };
  const allowed: string[] = [];
  let page = await read(null);
  while (true) {
    const checks = check(page.page.filter(document => document.sensitive === true).map(document => document.slug));
    if (page.isDone) { allowed.push(...await checks); return allowed; }
    if (!page.continueCursor) throw new Error("Incomplete access metadata pagination");
    const [slugs, nextPage] = await Promise.all([checks, read(page.continueCursor)]);
    allowed.push(...slugs);
    page = nextPage;
  }
}
