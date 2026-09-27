import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { invalidateManifest } from "./manifestRevision";

export const OWNED_RUN_PREFIX = "scoped:";

/** Checked inside the same transaction as each write, not just in HTTP auth.
 * Legacy unowned runs retain their existing API; they cannot touch an owned run.
 * The prefix lets us reject late writes even after the owner has finished. */
export function assertPublishRun(
  site: Doc<"sites"> | null,
  runId: string | undefined,
  options: { allowExpired?: boolean; document?: string; asset?: string; deletion?: boolean } = {},
) {
  if (!site?.publishRunId && !runId?.startsWith(OWNED_RUN_PREFIX)) return false;
  if (!site?.publishRunId || site.publishRunId !== runId) throw new Error("Publish conflict: run does not own the lock");
  if (!options.allowExpired && (!site.publishLockUntil || site.publishLockUntil <= Date.now())) throw new Error("Publish conflict: run lease expired");
  if (options.deletion) throw new Error("Publish conflict: scoped runs cannot delete records");
  if (options.document !== undefined && !site.publishScope?.documents.includes(options.document)) throw new Error("Publish conflict: document is outside the run scope");
  if (options.asset !== undefined && !site.publishScope?.assets.includes(options.asset)) throw new Error("Publish conflict: asset is outside the run scope");
  return true;
}

/** Call in the transaction that changes manifest-visible data, after ownership
 * validation. Only the first write patches the shared site row; later workers
 * remain independent. Undefined is left conservative for pre-upgrade runs. */
export async function recordPublishChange(ctx: MutationCtx, site: Doc<"sites"> | null, owned: boolean, documentSlug?: string) {
  if (!site) return;
  if (!owned) return invalidateManifest(ctx, site._id);
  if (site.publishJournalVersion === 1 && site.publishRunId) {
    const entry = { siteId: site._id, runId: site.publishRunId, kind: documentSlug === undefined ? "asset" as const : "document" as const, key: documentSlug ?? "*" };
    // eslint-disable-next-line no-restricted-syntax -- Caller resolved and validated the owning site; journal index includes its id.
    const prior = await ctx.db.query("publishChanges").withIndex("by_run_kind_key", q => q.eq("siteId", site._id).eq("runId", entry.runId).eq("kind", entry.kind).eq("key", entry.key)).first();
    if (!prior) await ctx.db.insert("publishChanges", entry);
  }
  if (site.publishRunChanged === false) await ctx.db.patch(site._id, { publishRunChanged: true });
}
