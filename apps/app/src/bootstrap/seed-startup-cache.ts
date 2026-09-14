import { type Store } from "@livestore/livestore";
import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import { siteState$ } from "../livestore/queries";
import { events } from "../livestore/schema";
import { manifestToEvent } from "../wiki-utils";
import { sameStartupIdentity, type StartupSnapshot } from "./reader-startup-cache";
import { cachedStartupStores } from "./seed-state";

export function seedStartupCache(store: Store, identity: WikiSessionIdentity, snapshot: StartupSnapshot) {
  if (!sameStartupIdentity(identity, snapshot.identity)) return;
  cachedStartupStores.add(store);
  // A running persisted database can already have newer updates/deletions.
  // Only restore a snapshot into an empty temporary/new store after identity
  // verification. Its original validation timestamps force normal revalidation.
  if (store.query(siteState$)) return;
  store.commit(manifestToEvent(snapshot.manifest, snapshot.validatedAt),
    ...snapshot.bodies.map(({ page, fetchedAt }) => events.pageContentFetched({ ...page, fetchedAt })));
}
