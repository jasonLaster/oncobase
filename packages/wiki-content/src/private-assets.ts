export function requiresPrivateAssetStorage(siteSlug: string, path: string) {
  return siteSlug === "diana" && path.startsWith("sources/diagnostics/single-cell/");
}

export function isPrivateAssetStorageUrl(url: URL) {
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    !url.search && !url.hash && /^[a-z0-9]+\.private\.blob\.vercel-storage\.com$/.test(url.hostname);
}
