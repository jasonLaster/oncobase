import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import { publishMetrics } from "./observability";
import { Header } from "./shell/Header";
import { LiveStoreDevtoolsFooter } from "./shell/LiveStoreDevtoolsFooter";
import { MobileNav, Sidebar } from "./shell/Navigation";
import { ResizableAppShell } from "./shell/ResizableAppShell";
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
  storageQuotaBytes: null,
  storagePressure: "unknown",
  lastSyncMs: null,
  coldRouteRenderMs: null,
  warmRouteRenderMs: null,
  lastRouteRenderMs: null,
  failedBodyFetches: 0,
};

const WikiPage = lazy(() =>
  import("./pages/WikiPage").then((module) => ({ default: module.WikiPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const SearchPage = lazy(() =>
  import("./pages/SearchPage").then((module) => ({ default: module.SearchPage })),
);
const TableExamplesPage = lazy(() =>
  import("./pages/TableExamplesPage").then((module) => ({
    default: module.TableExamplesPage,
  })),
);
const TimelinePage = lazy(() =>
  import("./pages/TimelinePage").then((module) => ({
    default: module.TimelinePage,
  })),
);
const DiagnosticImagingPage = lazy(() =>
  import("./pages/DiagnosticImagingPage").then((module) => ({
    default: module.DiagnosticImagingPage,
  })),
);
const DicomViewerPage = lazy(() =>
  import("./pages/DicomViewerPage").then((module) => ({
    default: module.DicomViewerPage,
  })),
);
const DicomComparePage = lazy(() =>
  import("./pages/DicomComparePage").then((module) => ({
    default: module.DicomComparePage,
  })),
);
const ChatPage = lazy(() =>
  import("./chat/ChatPage").then((module) => ({ default: module.ChatPage })),
);
const CommentsPage = lazy(() =>
  import("./pages/CommentsPage").then((module) => ({
    default: module.CommentsPage,
  })),
);
const TagPage = lazy(() =>
  import("./pages/TagPage").then((module) => ({ default: module.TagPage })),
);
const MedicalDeductionPage = lazy(() =>
  import("./pages/MedicalDeductionPage").then((module) => ({
    default: module.MedicalDeductionPage,
  })),
);
const AdminPage = lazy(() =>
  import("./admin/AdminPage").then((module) => ({ default: module.AdminPage })),
);
const PiiViewPage = lazy(() =>
  import("./pages/PiiViewPage").then((module) => ({ default: module.PiiViewPage })),
);

function PageFallback() {
  return (
    <article className="page-shell">
      <div className="loading-line">Preparing markdown renderer</div>
    </article>
  );
}

export function App({
  devtoolsFooterVisible,
  liveStoreDevtoolsEnabled,
  storeId,
}: {
  devtoolsFooterVisible: boolean;
  liveStoreDevtoolsEnabled: boolean;
  storeId: string;
}) {
  const scope = useWikiScope();
  const { pathname } = useLocation();
  const isImmersiveDicomRoute =
    pathname.startsWith("/tools/dicom-viewer") ||
    pathname.startsWith("/tools/dicom-compare");
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  useEffect(() => {
    publishMetrics(metrics);
  }, [metrics]);

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
      <div
        className="prototype-shell"
        data-immersive-route={isImmersiveDicomRoute ? "dicom-viewer" : undefined}
      >
        <Header />
        <ResizableAppShell sidebar={<Sidebar />}>
          <main className="content-shell">
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/table-examples" element={<TableExamplesPage />} />
                <Route path="/timeline" element={<TimelinePage />} />
                <Route path="/diagnostics" element={<TimelinePage />} />
                <Route path="/diagnostics/imaging" element={<DiagnosticImagingPage />} />
                <Route path="/tools/dicom-viewer" element={<DicomViewerPage />} />
                <Route path="/tools/dicom-compare" element={<DicomComparePage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/chat/:id" element={<ChatPage />} />
                <Route path="/comments" element={<CommentsPage />} />
                <Route path="/tags/:tag" element={<TagPage />} />
                <Route path="/tools/medical-deduction" element={<MedicalDeductionPage />} />
                <Route path="/access" element={<AdminPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/*" element={<AdminPage />} />
                <Route path="/pii-view/*" element={<PiiViewPage />} />
                <Route path="*" element={<WikiPage metrics={metrics} onMetrics={bumpMetrics} />} />
              </Routes>
            </Suspense>
          </main>
        </ResizableAppShell>
        <LiveStoreDevtoolsFooter
          enabled={liveStoreDevtoolsEnabled}
          metrics={metrics}
          scope={scope}
          storeId={storeId}
          visible={devtoolsFooterVisible}
        />
        <MobileNav />
      </div>
    </>
  );
}
