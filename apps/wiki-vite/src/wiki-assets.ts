import type { AssetIndexRow } from "./types";
import { backendHref } from "./wiki-utils";

export function assetFileName(path: string) {
  return path.split("/").at(-1) ?? path;
}

export function assetHref(path: string) {
  return backendHref(`/api/file?path=${encodeURIComponent(path)}`);
}

function sourceRootForSlug(slug: string) {
  return slug.replace(/\/index$/i, "");
}

export function relatedAssetsForSlug(slug: string, assets: AssetIndexRow[]) {
  const sourceRoot = sourceRootForSlug(slug);
  return assets
    .filter((asset) => {
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
