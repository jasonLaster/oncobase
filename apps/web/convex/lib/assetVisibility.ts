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
