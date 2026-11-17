import { readerFetch } from "../reader-telemetry";
import { useStore } from "@livestore/react";
import { createWikiContentClient } from "@oncobase/wiki-content";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router";
import type { MetricsPatch } from "../types";
import { useWikiScope } from "../wiki-context";
import { contentSlugFromRouteSlug, rememberSlug, slugFromPath } from "../wiki-utils";
import { on } from "../reader-bus";
import { BackgroundPrefetch } from "./BackgroundPrefetch";
import { REFRESH_MANIFEST_EVENT } from "./events";
import { createSyncController, type SyncController } from "./sync-controller";

/** Binds a `SyncController` to React and the window: one controller per
 * store, scope and client, fed route changes and the events it reacts to.
 * `background={false}` syncs the current route only (manifest and body), for
 * a store that is preparing to replace a presentation and not yet visible. */
export function WikiSync({ onMetrics, background = true }: { onMetrics: (patch: MetricsPatch) => void; background?: boolean }) {
  const { store } = useStore();
  const scope = useWikiScope();
  const location = useLocation();
  const currentSlug = contentSlugFromRouteSlug(slugFromPath(location.pathname));
  // Read when a controller is created, so it starts on the current route.
  const currentSlugRef = useRef(currentSlug);
  useEffect(() => { currentSlugRef.current = currentSlug; }, [currentSlug]);
  // The latest callback, without recreating the controller when it changes.
  const onMetricsRef = useRef(onMetrics);
  useEffect(() => { onMetricsRef.current = onMetrics; }, [onMetrics]);

  const client = useMemo(() => {
    const baseUrl = import.meta.env.VITE_WIKI_API_ORIGIN ?? "";
    return createWikiContentClient({ fetch: readerFetch,
      scope,
      baseUrl,
      credentials: baseUrl ? "include" : "same-origin",
      requestTimeoutMs: 30_000,
    });
  }, [scope]);

  const controllerRef = useRef<SyncController | null>(null);
  useEffect(() => {
    const next = createSyncController({
      store, client, scope, onMetrics: patch => onMetricsRef.current(patch),
    }, currentSlugRef.current);
    next.start();
    const onOnline = () => next.online();
    const onVisibility = () => next.visibilityChanged();
    const onDeparting = () => next.departing();
    const onResumed = () => next.resumed();
    const onRefresh = () => next.refreshManifest();
    const onRetry = () => next.retryPage();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onDeparting);
    window.addEventListener("pageshow", onResumed);
    // The window name is the test bridge (see ./events); the bus is the app's.
    window.addEventListener(REFRESH_MANIFEST_EVENT, onRefresh);
    const offRefresh = on("refresh-manifest", onRefresh);
    const offRetry = on("retry-page", onRetry);
    controllerRef.current = next;
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onDeparting);
      window.removeEventListener("pageshow", onResumed);
      window.removeEventListener(REFRESH_MANIFEST_EVENT, onRefresh);
      offRefresh();
      offRetry();
      next.dispose();
      if (controllerRef.current === next) controllerRef.current = null;
    };
  }, [client, scope, store]);

  // Runs after the controller effect, so a new controller already has this
  // route and the call is a no-op; afterwards it forwards each navigation.
  useEffect(() => { controllerRef.current?.setRoute(currentSlug); }, [currentSlug]);

  useEffect(() => {
    if (currentSlug !== "index") rememberSlug(currentSlug);
  }, [currentSlug]);

  const isForegroundBusy = useCallback(() => controllerRef.current?.isForegroundBusy() ?? false, []);
  return background ? <BackgroundPrefetch onMetrics={onMetrics} isForegroundBusy={isForegroundBusy} /> : null;
}
