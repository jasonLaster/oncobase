import { DiagnosticsSidebar } from "@oncobase/diagnostics/dicom";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { ResizableAppShell } from "./shell/ResizableAppShell";
import { SpecialRouteMetadata } from "./shell/SpecialRouteMetadata";

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

function PageFallback() {
  return (
    <article className="page-shell page-shell-loading" data-test-id="document-article">
      <WikiPageLoading data-test-id="page-loading" includeTags label="Loading page" />
    </article>
  );
}

/**
 * DICOM routes own their data lifecycle and do not read the wiki projection.
 * Keeping them outside LiveStore also prevents an OPFS boot from blocking a
 * reload of the viewer or comparison workspace.
 */
export function ImmersiveDicomRoot() {
  return (
    <BrowserRouter>
      <div className="prototype-shell" data-immersive-route="dicom-viewer">
        <SpecialRouteMetadata />
        <ResizableAppShell sidebar={<DiagnosticsSidebar />}>
          <main className="content-shell">
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/tools/dicom-viewer" element={<DicomViewerPage />} />
                <Route path="/tools/dicom-compare" element={<DicomComparePage />} />
              </Routes>
            </Suspense>
          </main>
        </ResizableAppShell>
      </div>
    </BrowserRouter>
  );
}
