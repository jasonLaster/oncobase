export type StoredAssetVisibility = {
  ownerSlugs?: string[];
  sensitive?: boolean;
};

export type SiblingDocumentVisibility = {
  sensitive?: boolean;
};

export function isStoredAssetSensitive(
  asset: StoredAssetVisibility | null | undefined,
  siblingDocument: SiblingDocumentVisibility | null | undefined,
) {
  if (
    !asset ||
    typeof asset.sensitive !== "boolean" ||
    !Array.isArray(asset.ownerSlugs)
  ) {
    return true;
  }
  return asset.sensitive || siblingDocument?.sensitive === true;
}
