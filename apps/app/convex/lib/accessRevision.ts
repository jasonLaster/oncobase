import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { hasActiveScopedWriter, MANIFEST_SNAPSHOT_VERSION } from "./manifestRevision";

/**
 * Version of the code that decides who may read what (access.ts rule
 * matching, accessPolicy.ts, the asset visibility rules). It is part of every
 * manifest "known" token, so a deploy that changes the policy invalidates every
 * token once. access-revision.contract.test.ts fingerprints those sources and
 * fails until this is reviewed and the fingerprint updated.
 */
export const ACCESS_POLICY_VERSION = 1;

/**
 * Record that what some user can read may have changed. Call it in the same
 * transaction as the write: role and rule edits, assignments, membership, the
 * site gate, and the metadata source switch. Content and sensitivity changes
 * already bump `manifestRevision` (lib/manifestRevision.ts), which is also part
 * of the token. A missed call here is a privacy bug: a reader would keep a
 * manifest that still lists pages they may no longer read (their page reads
 * are still authorized live).
 */
export async function bumpAccessRevision(ctx: MutationCtx, siteId: Id<"sites"> | null | undefined) {
  if (!siteId) return;
  const site = await ctx.db.get(siteId);
  if (!site) return;
  await ctx.db.patch(siteId, { accessRevision: (site.accessRevision ?? 0) + 1 });
}

export type ManifestFence = {
  manifestRevision: number;
  accessRevision: number;
  policyVersion: number;
  /** Hash of the installed public snapshot for the current revision, if any. */
  snapshotHash: string | null;
  /** A publisher holds (or held and has not released) the site. Content may
   * change without a revision bump until it finishes, so no token is valid. */
  publishing: boolean;
};

export function manifestFence(site: Doc<"sites">, now = Date.now()): ManifestFence {
  const manifestRevision = site.manifestRevision ?? 0;
  const snapshot = site.manifestSnapshot;
  const current = snapshot && snapshot.revision === manifestRevision && snapshot.formatVersion === MANIFEST_SNAPSHOT_VERSION;
  return {
    manifestRevision,
    accessRevision: site.accessRevision ?? 0,
    policyVersion: ACCESS_POLICY_VERSION,
    snapshotHash: current ? snapshot.hash : null,
    // Any run id counts, including an expired lease whose expiry job has not
    // run yet: its writes are visible but have not bumped the revision.
    publishing: Boolean(site.publishRunId) || (site.publishLockUntil ?? 0) > now || hasActiveScopedWriter(site, now),
  };
}
