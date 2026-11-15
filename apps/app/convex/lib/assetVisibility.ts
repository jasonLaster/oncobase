export type AssetVisibilityMetadata = {
  ownerSlugs?: string[];
  sensitive?: boolean;
};

export function hasCompleteAssetVisibility(
  asset: AssetVisibilityMetadata,
) {
  return (
    typeof asset.sensitive === "boolean" &&
    Array.isArray(asset.ownerSlugs)
  );
}

/** The document an asset implicitly belongs to (`a/b.pdf` -> `a/b`). */
export function assetPathToSiblingSlug(assetPath: string) {
  return assetPath.replace(/\.[^/.]+$/, "");
}
