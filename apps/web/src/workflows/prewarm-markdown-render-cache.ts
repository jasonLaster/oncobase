import { isHiddenFileTreePath } from "@/lib/file-tree-paths";

const PREWARM_RENDER_BATCH_SIZE = 16;
const MAX_PRIORITY_RENDER_PREWARM_SLUGS = 64;
const ASSET_EXTENSION_RE = /\.(?:avif|gif|jpe?g|pdf|png|svg|webp)$/i;
const EMPTY_PREWARM_RESULT: PrewarmMarkdownRenderCacheResult = {
  total: 0,
  warmed: 0,
  failed: 0,
  failures: [],
};

export interface PrewarmMarkdownRenderFailure {
  slug: string;
  error: string;
}

export interface PrewarmMarkdownRenderCacheResult {
  total: number;
  warmed: number;
  failed: number;
  failures: PrewarmMarkdownRenderFailure[];
}

interface PrewarmMarkdownRenderResult {
  slug: string;
  ok: boolean;
  bytes?: number;
  error?: string;
}

function shouldPrewarmRenderedSlug(slug: string) {
  if (!slug || slug.startsWith("sources/")) return false;
  if (isHiddenFileTreePath(slug)) return false;
  if (ASSET_EXTENSION_RE.test(slug)) return false;
  return slug === "index" || slug.startsWith("about/") || slug.startsWith("wiki/");
}

function normalizePrewarmSlug(slug: string) {
  return slug.trim().replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
}

function normalizePrioritySlugs(slugs: string[] = []) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawSlug of slugs) {
    const slug = normalizePrewarmSlug(rawSlug);
    if (!shouldPrewarmRenderedSlug(slug) || seen.has(slug)) continue;
    out.push(slug);
    seen.add(slug);
    if (out.length >= MAX_PRIORITY_RENDER_PREWARM_SLUGS) break;
  }
  return out;
}

async function listRenderPrewarmSlugs(siteSlug: string): Promise<string[]> {
  "use step";
  const { siteDataFromSlug } = await import("@/lib/site-data");
  const docs = await siteDataFromSlug(siteSlug).documents.list();
  return docs
    .map((doc: { slug: string }) => doc.slug)
    .filter(shouldPrewarmRenderedSlug)
    .sort((a, b) => {
      if (a === "index") return -1;
      if (b === "index") return 1;
      return a.localeCompare(b);
    });
}

async function prewarmOneRenderCache(
  siteSlug: string,
  slug: string,
): Promise<PrewarmMarkdownRenderResult> {
  try {
    const { getMarkdownFileForSite } = await import("@/lib/markdown");
    const { renderCachedMarkdownHtmlForSite } = await import(
      "@/lib/markdown-render-cache"
    );
    const { toSiteSlug } = await import("@/lib/site");

    const file = await getMarkdownFileForSite(toSiteSlug(siteSlug), slug);
    if (!file) {
      return { slug, ok: false, error: "document not found" };
    }

    const html = await renderCachedMarkdownHtmlForSite({
      siteSlug,
      slug: file.slug,
      contentHash: file.contentHash,
      content: file.contentHash ? undefined : file.content,
      includeSensitive: false,
      redactionMode: "redacted",
    });

    return { slug: file.slug, ok: true, bytes: html.length };
  } catch (error) {
    return {
      slug,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function prewarmRenderCacheBatch(
  siteSlug: string,
  slugs: string[],
): Promise<PrewarmMarkdownRenderResult[]> {
  "use step";
  return Promise.all(slugs.map((slug) => prewarmOneRenderCache(siteSlug, slug)));
}

async function prewarmRenderCacheBatches(
  siteSlug: string,
  slugs: string[],
  label: string,
): Promise<PrewarmMarkdownRenderResult[]> {
  const results: PrewarmMarkdownRenderResult[] = [];
  for (let i = 0; i < slugs.length; i += PREWARM_RENDER_BATCH_SIZE) {
    const batch = slugs.slice(i, i + PREWARM_RENDER_BATCH_SIZE);
    const batchResults = await prewarmRenderCacheBatch(siteSlug, batch);
    results.push(...batchResults);
    const warmed = results.filter((result) => result.ok).length;
    console.log(
      `[prewarm-markdown-render-cache] ${label} batch ${Math.floor(i / PREWARM_RENDER_BATCH_SIZE) + 1}/${Math.ceil(slugs.length / PREWARM_RENDER_BATCH_SIZE)} warmed=${warmed}/${results.length}`,
    );
  }
  return results;
}

export async function prewarmMarkdownRenderCacheWorkflow(
  siteSlug = "diana",
  prioritySlugs: string[] = [],
): Promise<PrewarmMarkdownRenderCacheResult> {
  "use workflow";

  const priority = normalizePrioritySlugs(prioritySlugs);
  console.log(
    `[prewarm-markdown-render-cache] Workflow started site=${siteSlug} priority=${priority.length}`,
  );

  const priorityResults = priority.length
    ? await prewarmRenderCacheBatches(siteSlug, priority, "Priority")
    : [];
  const priorityRequested = new Set(priority);
  const priorityWarmed = new Set(
    priorityResults.filter((result) => result.ok).map((result) => result.slug),
  );
  const slugs = (await listRenderPrewarmSlugs(siteSlug)).filter(
    (slug) => !priorityRequested.has(slug) && !priorityWarmed.has(slug),
  );

  if (priorityResults.length === 0 && slugs.length === 0) {
    console.log(
      `[prewarm-markdown-render-cache] Complete warmed=0/0 failed=0`,
    );
    return EMPTY_PREWARM_RESULT;
  }

  const results = [
    ...priorityResults,
    ...(slugs.length
      ? await prewarmRenderCacheBatches(siteSlug, slugs, "Full")
      : []),
  ];

  const failures = results
    .filter((result) => !result.ok)
    .map((result) => ({
      slug: result.slug,
      error: result.error ?? "unknown failure",
    }));

  const summary = {
    total: results.length,
    warmed: results.length - failures.length,
    failed: failures.length,
    failures,
  };

  console.log(
    `[prewarm-markdown-render-cache] Complete warmed=${summary.warmed}/${summary.total} failed=${summary.failed}`,
  );

  return summary;
}
