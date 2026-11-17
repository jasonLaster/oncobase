// SPIKE (P3 design, 2026-11-17). Not for shipping.
// The element tree ReaderSession renders while "presenting" (no store,
// InitialReaderContext from the document payload). The server renders it under
// a StaticRouter, the client hydrates it under a BrowserRouter.
import { StrictMode, type ReactNode } from "react";
import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import { App } from "../../src/App";
import { InitialReaderContext, ReaderStoreContext } from "../../src/bootstrap/reader-queries";
import type { InitialReaderData } from "../../src/bootstrap/initial-reader-data";
import { CanonicalRouteBoundary } from "../../src/CanonicalRouteBoundary";
import { WikiAuthProvider } from "../../src/shell/Header";
import { WikiIdentityPendingContext, WikiScopeProvider, WikiSessionProvider } from "../../src/wiki-context";

export type Fixture = { url: string; identity: WikiSessionIdentity; initial: InitialReaderData };

export function ReaderFirstFrame({ identity, initial, Router }: Fixture & { Router: (props: { children: ReactNode }) => ReactNode }) {
  return (
    <StrictMode>
      <Router>
        <WikiIdentityPendingContext.Provider value={true}>
          <div hidden data-reader-cache-startup="false" />
          <ReaderStoreContext.Provider value={null}>
            <InitialReaderContext.Provider value={initial}>
              <WikiSessionProvider identity={identity}>
                <WikiScopeProvider scope="public">
                  <WikiAuthProvider>
                    <CanonicalRouteBoundary>
                      <App devtoolsFooterVisible={false} liveStoreDevtoolsEnabled={false} storeId="" />
                    </CanonicalRouteBoundary>
                  </WikiAuthProvider>
                </WikiScopeProvider>
              </WikiSessionProvider>
            </InitialReaderContext.Provider>
          </ReaderStoreContext.Provider>
        </WikiIdentityPendingContext.Provider>
      </Router>
    </StrictMode>
  );
}
