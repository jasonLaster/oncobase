export const MARKDOWN_RENDER_CACHE_VERSION = "29";

export function siteCacheTag(siteSlug: string) {
  return `site:${siteSlug}`;
}

export function siteDocsCacheTag(siteSlug: string) {
  return `${siteCacheTag(siteSlug)}:docs`;
}

export function siteAssetsCacheTag(siteSlug: string) {
  return `${siteCacheTag(siteSlug)}:assets`;
}

export function siteTreeCacheTag(siteSlug: string) {
  return `${siteCacheTag(siteSlug)}:tree`;
}

export function siteTagsCacheTag(siteSlug: string) {
  return `${siteCacheTag(siteSlug)}:tags`;
}

export function siteRenderCacheTag(siteSlug: string) {
  return `${siteCacheTag(siteSlug)}:render:v${MARKDOWN_RENDER_CACHE_VERSION}`;
}

export function siteDocCacheTag(siteSlug: string, slug: string) {
  return `${siteCacheTag(siteSlug)}:doc:${slug}`;
}
