import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { WikiPageActionButton } from "@oncobase/wiki-shell";
import { WikiEmptyState } from "@oncobase/wiki-shell/page-states";
import { ScopedErrorBoundary } from "./ScopedErrorBoundary";

function RouteErrorFallback({ retry }: { retry: () => void }) {
  return (
    <WikiEmptyState
      data-test-id="route-error"
      data-reader-unavailable="true"
      title="This page couldn't be displayed"
      description="Something went wrong while showing this page. Your saved pages and navigation still work."
      actions={
        <>
          <WikiPageActionButton data-test-id="route-error-retry" onClick={retry}>
            Try again
          </WikiPageActionButton>
          <WikiPageActionButton data-test-id="route-error-reload" onClick={() => window.location.reload()}>
            Reload
          </WikiPageActionButton>
        </>
      }
    />
  );
}

/**
 * Page-level boundary: a broken route keeps the shell (sidebar, header) and
 * offers a retry instead of the root card's cache reset. Navigating away
 * clears the error. Only this small wrapper subscribes to the location.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ScopedErrorBoundary
      boundary="route"
      propagateChunkErrors
      resetKey={pathname}
      fallback={retry => <RouteErrorFallback retry={retry} />}
    >
      {children}
    </ScopedErrorBoundary>
  );
}
