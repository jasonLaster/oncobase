export type StoredAssetVisibility = {
  sensitive?: boolean;
};

export type SiblingDocumentVisibility = {
  sensitive?: boolean;
};

export function isStoredAssetSensitive(
  asset: StoredAssetVisibility | null | undefined,
  siblingDocument: SiblingDocumentVisibility | null | undefined,
) {
  if (asset?.sensitive !== undefined) return asset.sensitive;
  return siblingDocument?.sensitive === true;
}
