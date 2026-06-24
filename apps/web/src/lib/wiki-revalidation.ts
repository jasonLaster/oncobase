import { revalidatePath, revalidateTag } from "next/cache";
import {
  siteAssetsCacheTag,
  siteCacheTag,
  siteDocCacheTag,
  siteDocsCacheTag,
  siteTagsCacheTag,
  siteTreeCacheTag,
} from "@/lib/wiki-cache-tags";

const IMMEDIATE = { expire: 0 } as const;

function revalidateTags(tags: string[]) {
  for (const tag of tags) {
    revalidateTag(tag, IMMEDIATE);
  }
}

export function revalidatePublishedDocument(siteSlug: string, slug: string) {
  revalidateTags([
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
    siteTagsCacheTag(siteSlug),
    siteDocCacheTag(siteSlug, slug),
  ]);
}

export function revalidatePublishedAsset(siteSlug: string) {
  revalidateTags([
    siteCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
  ]);
}

export function revalidateSiteAfterPublish(siteSlug: string) {
  revalidateTags([
    siteCacheTag(siteSlug),
    siteDocsCacheTag(siteSlug),
    siteAssetsCacheTag(siteSlug),
    siteTreeCacheTag(siteSlug),
    siteTagsCacheTag(siteSlug),
  ]);
  revalidatePath("/", "layout");
}
