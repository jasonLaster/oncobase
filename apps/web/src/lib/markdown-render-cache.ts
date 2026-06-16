import { cacheLife, cacheTag } from "next/cache";
import { renderMarkdownAsync } from "@/lib/render-markdown";
import { getMarkdownFileForSite } from "@/lib/markdown";
import type { PiiRedactionMode } from "@/lib/pii-redaction";
import { resolveWikilinks } from "@/lib/wikilinks";
import { toSiteSlug } from "@/lib/site";
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
  includeSensitive,
  redactionMode,
}: {
  siteSlug: string;
  slug: string;
  contentHash?: string | null;
  content?: string;
  includeSensitive?: boolean;
  redactionMode?: PiiRedactionMode;
}): Promise<string> {
  if (contentHash && content == null) {
    return renderCachedMarkdownHtmlByHash({
      siteSlug,
      slug,
      contentHash,
      includeSensitive,
      renderCacheVersion: MARKDOWN_RENDER_CACHE_VERSION,
    });
  }

  return renderCachedMarkdownHtml({
    siteSlug,
    slug,
    contentHash,
    content,
    includeSensitive,
    redactionMode,
    renderCacheVersion: MARKDOWN_RENDER_CACHE_VERSION,
  });
}

async function renderCachedMarkdownHtmlByHash(args: {
  siteSlug: string;
  slug: string;
  contentHash: string;
  includeSensitive?: boolean;
  renderCacheVersion: string;
}): Promise<string> {
  "use cache";
  const {
    siteSlug,
    slug,
    contentHash,
    includeSensitive = false,
    renderCacheVersion,
  } = args;
  cacheLife("weeks");
  cacheTag(
    siteCacheTag(siteSlug),
    siteRenderCacheTag(siteSlug),
    `${siteRenderCacheTag(siteSlug)}:${renderCacheVersion}`,
    `${siteRenderCacheTag(siteSlug)}:${renderCacheVersion}:${contentHash}`,
    siteDocCacheTag(siteSlug, slug),
  );

  const file = await getMarkdownFileForSite(toSiteSlug(siteSlug), slug, {
    includeSensitive,
  });
  if (!file) {
    throw new Error(`Cannot render missing markdown cache entry: ${siteSlug}/${slug}`);
  }

  const resolved = resolveWikilinks(file.content, slug);
  return await renderMarkdownAsync(resolved, slug);
}

async function renderCachedMarkdownHtml(args: {
  siteSlug: string;
  slug: string;
  contentHash?: string | null;
  content?: string;
  includeSensitive?: boolean;
  redactionMode?: PiiRedactionMode;
  renderCacheVersion: string;
}): Promise<string> {
  "use cache";
  const { siteSlug, slug, content, redactionMode = "redacted", renderCacheVersion } = args;
  if (content == null) {
    throw new Error(
      `Cannot render markdown cache entry without content: ${siteSlug}/${slug}`,
    );
  }

  cacheLife("weeks");
  cacheTag(
    siteCacheTag(siteSlug),
    siteRenderCacheTag(siteSlug),
    `${siteRenderCacheTag(siteSlug)}:${renderCacheVersion}`,
    siteDocCacheTag(siteSlug, slug),
  );

  const resolved = resolveWikilinks(content, slug);
  return await renderMarkdownAsync(resolved, slug, { redactionMode });
}
