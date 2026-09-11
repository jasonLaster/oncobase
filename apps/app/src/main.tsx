import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";
import { AppErrorBoundary, reloadOnceForLoadError } from "./AppErrorBoundary";
import { publishRuntimeEnvironment } from "./observability";

// Retire inert HTML copies from older releases. Structured reader data remains
// cached, but only React renders its controls and document content.
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("wiki-vite:first-frame:")) localStorage.removeItem(key);
  }
} catch { /* Reading still works when local storage is unavailable. */ }

if (new URLSearchParams(location.search).get("paintDebug") === "1" && !window.__WIKI_VISUAL_STABILITY__) {
  void import("./visual-stability").then(({ installVisualStabilityObserver }) => {
    installVisualStabilityObserver();
  }).catch(() => console.warn("Visual diagnostics could not be loaded"));
}

// Vite throws this when a dynamic import's JS/CSS fails to load — most often a
// tab left open across a deploy. Recover by reloading once; if we already
// reloaded this session, let it propagate to the error boundary instead of
// silently swallowing the failure.
window.addEventListener("vite:preloadError", () => {
  reloadOnceForLoadError();
  // Preserve the rejected import while navigation is pending. Preventing the
  // event makes Vite resolve it as undefined, which can crash React.lazy with
  // an unrelated TypeError and incorrectly restart the reader store.
});

publishRuntimeEnvironment({
  mode: import.meta.env.MODE,
  vercelEnv: import.meta.env.VITE_VERCEL_ENV,
  commitSha: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA,
});

const WikiViteRoot = lazy(() =>
  import("./WikiViteRoot").then((module) => ({ default: module.WikiViteRoot })),
);
const ImmersiveDicomRoot = lazy(() =>
  import("./ImmersiveDicomRoot").then((module) => ({
    default: module.ImmersiveDicomRoot,
  })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const TermsAndConditionsPage = lazy(() =>
  import("./pages/TermsAndConditionsPage").then((module) => ({
    default: module.TermsAndConditionsPage,
  })),
);

function RootRouteBoundary() {
  const { pathname } = useLocation();
  // Only reader routes need a wiki session or database. This single boundary
  // applies to cold loads, client navigation, and browser history alike.
  if (pathname === "/login") return <LoginPage />;
  if (pathname === "/terms-and-conditions") return <TermsAndConditionsPage />;
  if (pathname === "/tools/dicom-viewer" || pathname === "/tools/dicom-compare") {
    return <ImmersiveDicomRoot />;
  }
  return <WikiViteRoot />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<WikiPageLoading data-test-id="page-loading" includeTags label="Loading page" />}>
          <RootRouteBoundary />
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
