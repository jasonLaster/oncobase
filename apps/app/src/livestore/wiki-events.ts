import type { WikiManifest, WikiPageRecord } from "@oncobase/wiki-content";
import { byteSize } from "../wiki-utils";
import { events } from "./schema";

// Store-side only. The paint-critical graph imports wiki-utils for slug
// helpers; keeping these builders here keeps the LiveStore schema (and Effect)
// out of that graph.
export function manifestToEvent(manifest: WikiManifest, receivedAt: number) {
  return events.manifestApplied({
    siteSlug: manifest.siteSlug,
    scope: manifest.scope,
    manifestHash: manifest.manifestHash,
    generatedAt: manifest.generatedAt,
    receivedAt,
    manifestSize: byteSize(JSON.stringify(manifest)),
    compactTreeJson: JSON.stringify(manifest.compactTree),
    pagesJson: JSON.stringify(manifest.pages),
    assetsJson: JSON.stringify(manifest.assets),
  });
}

export function pageToEvent(page: WikiPageRecord) {
  return events.pageContentFetched({
    slug: page.slug,
    title: page.title,
    content: page.content,
    tags: page.tags,
    contentHash: page.contentHash,
    sensitive: page.sensitive,
    size: byteSize(page.content),
    fetchedAt: Date.now(),
  });
}
