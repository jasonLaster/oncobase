import type { WikiScope } from "@oncobase/wiki-content";

/** How long a validated manifest is trusted before a check is worth making. */
export const MANIFEST_FRESH_MS: Record<WikiScope, number> = {
  public: 60_000,
  session: 30_000,
};
export const MANIFEST_RETRY_MS = 30_000;
/** Ceiling for unattended checks and for retries after failed refreshes. */
export const MANIFEST_MAX_IDLE_MS = 5 * 60_000;

/**
 * Why a manifest check was requested.
 * - `load`: first check for a store. Visible: the reader may be showing a saved copy.
 * - `user`: an explicit Retry or refresh. Visible.
 * - `attention`: the reader came back (tab shown, network restored, navigation).
 *   Quiet, and it restores the base cadence.
 * - `timer`: nobody asked. Quiet, and each unchanged result lengthens the wait.
 */
export type ManifestCheckReason = "load" | "user" | "attention" | "timer";

/** Delay before the next unattended check after `unchangedChecks` in a row found nothing new. */
export function nextManifestCheckDelay(scope: WikiScope, unchangedChecks: number) {
  return Math.min(MANIFEST_MAX_IDLE_MS, MANIFEST_FRESH_MS[scope] * 2 ** Math.min(Math.max(0, unchangedChecks), 10));
}

/** Delay before retrying a refresh that failed or came back partial `failures` times in a row. */
export function nextManifestRetryDelay(failures: number) {
  return Math.min(MANIFEST_MAX_IDLE_MS, MANIFEST_RETRY_MS * 2 ** Math.min(Math.max(0, failures), 10));
}

/** A check may flip the visible status (and its live region) only when the
 * reader asked for it or has nothing to show yet. */
export function announcesManifestCheck(reason: ManifestCheckReason, hasCachedManifest: boolean) {
  return !hasCachedManifest || reason === "load" || reason === "user";
}

/** Timers keep running in background tabs; a hidden reader must not spend
 * requests on them. Becoming visible triggers its own check. */
export function timerMayCheck(visibilityState: DocumentVisibilityState) {
  return visibilityState !== "hidden";
}
