import type { Doc } from "../_generated/dataModel";

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
