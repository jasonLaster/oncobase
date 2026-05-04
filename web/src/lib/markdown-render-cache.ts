import { cacheLife, cacheTag } from "next/cache";
import { renderMarkdownAsync } from "@/lib/render-markdown";
import { resolveWikilinks } from "@/lib/wikilinks";
import {
  MARKDOWN_RENDER_CACHE_VERSION,
  siteCacheTag,
  siteDocCacheTag,
  siteRenderCacheTag,
} from "@/lib/wiki-cache-tags";

export { MARKDOWN_RENDER_CACHE_VERSION } from "@/lib/wiki-cache-tags";

export async function renderCachedMarkdownHtmlForSite({
  siteSlug,
  slug,
  contentHash,
  content,
}: {
  siteSlug: string;
  slug: string;
  contentHash?: string | null;
  content: string;
}): Promise<string> {
  return renderCachedMarkdownHtml({
    siteSlug,
    slug,
    contentHash,
    content,
    renderCacheVersion: MARKDOWN_RENDER_CACHE_VERSION,
  });
}

async function renderCachedMarkdownHtml(args: {
  siteSlug: string;
  slug: string;
  contentHash?: string | null;
  content: string;
  renderCacheVersion: string;
}): Promise<string> {
  "use cache";
  const { siteSlug, slug, content, renderCacheVersion } = args;
  cacheLife("weeks");
  cacheTag(
    siteCacheTag(siteSlug),
    siteRenderCacheTag(siteSlug),
    `${siteRenderCacheTag(siteSlug)}:${renderCacheVersion}`,
    siteDocCacheTag(siteSlug, slug),
  );

  const resolved = resolveWikilinks(content, slug);
  return await renderMarkdownAsync(resolved, slug);
}
