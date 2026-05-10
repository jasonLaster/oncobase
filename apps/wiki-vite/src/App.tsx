import { lazy, Suspense, useCallback, useState } from "react";
import { Route, Routes } from "react-router";
import { Header } from "./shell/Header";
import { LiveStoreDevtoolsFooter } from "./shell/LiveStoreDevtoolsFooter";
import { MetricsPanel } from "./shell/MetricsPanel";
import { MobileNav, Sidebar } from "./shell/Navigation";
import { WikiSync } from "./sync/WikiSync";
import type { Metrics } from "./types";
import { useWikiScope } from "./wiki-context";

const initialMetrics: Metrics = {
  status: "idle",
  message: "Waiting for LiveStore",
  manifestBytes: 0,
  markdownBytes: 0,
  eventCount: 0,
  opfsBytes: null,
  lastSyncMs: null,
  coldRouteRenderMs: null,
  warmRouteRenderMs: null,
  lastRouteRenderMs: null,
  failedBodyFetches: 0,
};

const WikiPage = lazy(() =>
  import("./pages/WikiPage").then((module) => ({ default: module.WikiPage })),
);

function PageFallback() {
  return (
    <article className="page-shell">
      <div className="loading-line">Preparing markdown renderer</div>
    </article>
  );
}

export function App({
  liveStoreDevtoolsEnabled,
  storeId,
}: {
  liveStoreDevtoolsEnabled: boolean;
  storeId: string;
}) {
  const scope = useWikiScope();
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  const bumpMetrics = useCallback((patch: Partial<Metrics>) => {
    setMetrics((current) => ({
      ...current,
      ...patch,
      eventCount:
        patch.eventCount == null ? current.eventCount : current.eventCount + patch.eventCount,
      failedBodyFetches:
        patch.failedBodyFetches == null
          ? current.failedBodyFetches
          : current.failedBodyFetches + patch.failedBodyFetches,
      markdownBytes:
        patch.markdownBytes == null
          ? current.markdownBytes
          : current.markdownBytes + patch.markdownBytes,
    }));
  }, []);

  return (
    <>
      <WikiSync onMetrics={bumpMetrics} />
      <div className="prototype-shell">
        <Header scope={scope} metrics={metrics} />
        <div className="app-shell">
          <Sidebar />
          <main className="content-shell">
            <MetricsPanel metrics={metrics} />
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="*" element={<WikiPage metrics={metrics} onMetrics={bumpMetrics} />} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <LiveStoreDevtoolsFooter enabled={liveStoreDevtoolsEnabled} storeId={storeId} />
        <MobileNav />
      </div>
    </>
  );
}
