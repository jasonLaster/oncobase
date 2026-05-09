import { useCallback, useState } from "react";
import { Route, Routes } from "react-router";
import { WikiPage } from "./pages/WikiPage";
import { Header } from "./shell/Header";
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
};

export function App() {
  const scope = useWikiScope();
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  const bumpMetrics = useCallback((patch: Partial<Metrics>) => {
    setMetrics((current) => ({
      ...current,
      ...patch,
      eventCount:
        patch.eventCount == null ? current.eventCount : current.eventCount + patch.eventCount,
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
            <Routes>
              <Route path="*" element={<WikiPage onMetrics={bumpMetrics} />} />
            </Routes>
          </main>
        </div>
        <MobileNav />
      </div>
    </>
  );
}
