import { useStore } from "@livestore/react";
import type { WikiScope } from "@oncobase/wiki-content";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router";
import type { ReaderHandoffOutcome } from "../../shared/reader-telemetry";
import { SESSION_HANDOFF_TIMEOUT_MS, sessionRouteReady } from "../bootstrap/session-handoff";
import { pageContentBySlug$, siteState$ } from "../livestore/queries";
import type { MetricsPatch } from "../types";
import { WikiScopeProvider } from "../wiki-context";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import { WikiSync } from "./WikiSync";

/**
 * Renders nothing. Runs inside a running, not-yet-visible store and syncs only
 * the current route, so the visible reader keeps one app tree (one WikiSync,
 * one set of test ids, title updates and shortcuts) while it waits. Settles
 * once that route can render from the store, when sync fails, or at the deadline.
 */
export function SessionHandoffSync({ scope, onSettled, timeoutMs = SESSION_HANDOFF_TIMEOUT_MS }: {
  scope: WikiScope;
  onSettled: (outcome: Exclude<ReaderHandoffOutcome, "remount-required">) => void;
  timeoutMs?: number;
}) {
  const { store } = useStore();
  const { pathname } = useLocation();
  const slug = contentSlugFromRouteSlug(slugFromPath(pathname));
  const page = store.useQuery(pageContentBySlug$(slug));
  const state = store.useQuery(siteState$);
  const [failed, setFailed] = useState(false);
  // The visible reader renders these states itself after the swap.
  const onMetrics = useCallback((patch: MetricsPatch) => {
    if (patch.status === "error" || patch.status === "offline") setFailed(true);
  }, []);
  const outcome = sessionRouteReady(slug, page, state) ? "kept-mounted" : failed ? "sync-error" : null;
  // Before paint: the visible tree switches stores in the same commit.
  useLayoutEffect(() => {
    if (outcome) onSettled(outcome);
  }, [outcome, onSettled]);
  useEffect(() => {
    const timer = window.setTimeout(() => onSettled("timeout"), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onSettled, timeoutMs]);
  return (
    <WikiScopeProvider scope={scope}>
      <WikiSync onMetrics={onMetrics} background={false} />
    </WikiScopeProvider>
  );
}
