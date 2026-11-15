import { isListedManifestAsset, withContentVersion } from "@oncobase/wiki-content";
import type { AssetIndexRow } from "./types";
import { backendHref } from "./wiki-utils";

export function assetFileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

export function assetHref(path: string, contentHash?: string | null) {
  return withContentVersion(backendHref(`/api/file?path=${encodeURIComponent(path)}`), contentHash);
}

function sourceRootForSlug(slug: string) {
  return slug.replace(/\/index$/i, "");
}

export function relatedAssetsForSlug(slug: string, assets: AssetIndexRow[]) {
  const sourceRoot = sourceRootForSlug(slug);
  return assets
    .filter((asset) => {
      // Image rows carry hashes for versioned URLs; they are not attachments.
      if (!isListedManifestAsset(asset)) return false;
      const withoutExtension = asset.path.replace(/\.[^/.]+$/, "");
      return (
        withoutExtension === sourceRoot ||
        asset.path.startsWith(`${sourceRoot}/`) ||
        asset.path.startsWith(`${sourceRoot}.`)
      );
    })
    .sort((left, right) => {
      if (left.kind === "pdf" && right.kind !== "pdf") return -1;
      if (left.kind !== "pdf" && right.kind === "pdf") return 1;
      return left.path.localeCompare(right.path);
    });
}

/** Manifest asset hashes by stored path, for content-addressed file URLs (P11). */
export function assetHashesByPath(assets: readonly Pick<AssetIndexRow, "path" | "contentHash">[]) {
  const hashes = new Map<string, string>();
  for (const asset of assets) if (asset.contentHash) hashes.set(asset.path, asset.contentHash);
  return hashes;
}

/**
 * A `/api/file?path=…` URL with `v=<contentHash>` when the manifest knows the
 * asset's hash; any other URL unchanged. The server serves a matching `v`
 * with a year-long private cache, so reopening an image costs no request.
 */
export function versionedFileUrl(url: string | undefined, hashes: ReadonlyMap<string, string>): string | undefined {
  if (!url || hashes.size === 0) return url;
  const query = url.match(/\/api\/(?:education\/)?(?:api\/)?file\?([^#]*)/);
  if (!query) return url;
  const params = new URLSearchParams(query[1]);
  if (params.has("v")) return url;
  const path = params.get("path");
  const hash = path ? hashes.get(path) ?? hashes.get(path.replace(/^\/+/, "")) : undefined;
  return hash ? withContentVersion(url, hash) : url;
}
