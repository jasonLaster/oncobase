import { bootScriptStart } from "./boot-timing";
import { clearStartupSnapshot } from "./bootstrap/startup-cache-lifecycle";
import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect } from "react";
import { educationOnlyResponse } from "./education-access";
import { landingResponse, rootRouteFor } from "./root-route";
import { prefetchReaderSession } from "./reader-session-prefetch";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";
import { AppErrorBoundary, reloadOnceForLoadError } from "./AppErrorBoundary";
import { AppStarting } from "./AppStarting";
import { publishRuntimeEnvironment } from "./observability";
import { observeReaderVitals, recordReaderPhase } from "./reader-telemetry";
const initialRoute = rootRouteFor(location.pathname, educationOnlyResponse(), landingResponse());
// Specialist viewers do not need the reader's schema or database imports.
// Keep that dependency graph outside their startup path. A reader load starts
// evaluating the (modulepreloaded) reader graph now, before the first render.
const readerModule = initialRoute === "reader" ? import("./WikiViteRoot") : null;
let ReadyWikiViteRoot: typeof import("./WikiViteRoot").WikiViteRoot | undefined;
const WikiViteRoot = lazy(() => (readerModule ?? import("./WikiViteRoot")).then(module => ({ default: module.WikiViteRoot })));
const EducationApp = lazy(() => import("./education/EducationApp").then(module => ({ default: module.EducationApp })));

// A login response supersedes previously remembered access, including a gate
// redirect after cookie expiration. Never revive it on Back/reload.
if (["/login", "/sign-in"].includes(location.pathname) || landingResponse()) clearStartupSnapshot();

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
  // Reading response metadata keeps server-only releases out of JS hashes.
  commitSha: document.querySelector<HTMLMetaElement>('meta[name="wiki-build-commit"]')?.content || undefined,
});
observeReaderVitals();
recordReaderPhase("boot-script", undefined, bootScriptStart);

const ImmersiveDicomRoot = lazy(() =>
  import("./ImmersiveDicomRoot").then((module) => ({
    default: module.ImmersiveDicomRoot,
  })),
);
const PathologyViewerPage = lazy(() =>
  import("./pages/PathologyViewerPage").then(module => ({ default: module.PathologyViewerPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const SignInPage = lazy(() =>
  import("./pages/SignInPage").then((module) => ({ default: module.SignInPage })),
);
const TermsAndConditionsPage = lazy(() =>
  import("./pages/TermsAndConditionsPage").then((module) => ({
    default: module.TermsAndConditionsPage,
  })),
);

function RootRouteBoundary() {
  const { pathname, search, hash } = useLocation();
  // Only reader routes need a wiki session or database. This single boundary
  // applies to cold loads, client navigation, and browser history alike.
  const route = rootRouteFor(pathname, educationOnlyResponse(), landingResponse());
  const needsPassword = route === "password";
  useEffect(() => {
    if (needsPassword) window.location.replace(`/sign-in?redirect=${encodeURIComponent(`${pathname}${search}${hash}`)}`);
  }, [needsPassword, pathname, search, hash]);
  switch (route) {
    case "password": return <AppStarting />;
    case "education": return <EducationApp />;
    case "login": return <LoginPage />;
    case "sign-in": return <SignInPage />;
    case "terms": return <TermsAndConditionsPage />;
    case "pathology": return <PathologyViewerPage />;
    case "dicom": return <ImmersiveDicomRoot />;
    case "reader": return ReadyWikiViteRoot ? <ReadyWikiViteRoot /> : <WikiViteRoot />;
  }
}

let firstCommit = true;
function FirstCommit() {
  useLayoutEffect(() => {
    if (firstCommit) recordReaderPhase("boot-react-commit");
    firstCommit = false;
  }, []);
  return null;
}

// Verify the session while the reader chunk downloads, not after it mounts.
if (initialRoute === "reader") prefetchReaderSession();

recordReaderPhase("boot-entry");
const render = () => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FirstCommit />
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<AppStarting />}>
          <RootRouteBoundary />
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
// React holds a Suspense reveal until 300 ms after its fallback committed, so a
// lazy reader resolving just after the first commit delayed identity and store
// startup by ~300 ms. Render the loaded reader directly instead; the HTML's
// identical startup placeholder covers the wait. A failed import renders the
// lazy path, which rethrows into the error boundary's reload-once recovery.
if (readerModule) void readerModule.then(module => { ReadyWikiViteRoot = module.WikiViteRoot; }, () => {}).finally(render);
else render();
