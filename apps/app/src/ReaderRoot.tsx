import { makeWikiStoreId, type WikiScope, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { sameStartupIdentity, startupInitialData, type StartupSnapshot } from "./bootstrap/reader-startup-cache";
import { keepsPresentationMounted } from "./bootstrap/session-handoff";
import type { ReaderHandoffOutcome } from "../shared/reader-telemetry";
import { readInitialReaderData } from "./bootstrap/initial-reader-data";
import { InitialReaderContext, ReaderStoreContext, type ReaderStoreKit } from "./bootstrap/reader-queries";
import { readerBootRequest } from "./bootstrap/seed-state";
import { App } from "./App";
import { ReaderPending } from "./AppStarting";
import { CanonicalRouteBoundary } from "./CanonicalRouteBoundary";
import { WikiAuthProvider } from "./shell/Header";
import { WikiScopeProvider, WikiSessionProvider } from "./wiki-context";
import { readDevtoolsFooterVisible, readLiveStoreDevtoolsEnabled } from "./livestore/devtools";
import { markSessionHandoff, markVisualPhase } from "./visual-phase";
import type { StoreHostProps } from "./livestore/StoreHost";
import { startEarlyRead } from "./bootstrap/early-requests";

// Paint-critical half of the reader: React, the shell and the markdown
// renderer. It presents the page this document carried (or the saved startup
// snapshot) without the database, then imports the store half
// (livestore/StoreHost.tsx: Effect, LiveStore, workers, SQLite), which attaches
// through the same handoff the cached reader always used.

const loadStoreHost = () => import("./livestore/StoreHost");
const StoreStartupRecovery = lazy(() => import("./livestore/StoreStartupRecovery"));

export function ReaderRoot({ identity, presentationIdentity, scope, cachedSnapshot }: {
  cachedSnapshot?: StartupSnapshot | null;
  identity: WikiSessionIdentity | null;
  presentationIdentity?: WikiSessionIdentity | null;
  scope: WikiScope;
}) {
  const storeId = identity ? makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope,
    origin: window.location.origin,
    cacheKey: identity.cacheKey,
  }) : null;
  const [firstPartition, setFirstPartition] = useState(storeId);
  if (storeId && !firstPartition) setFirstPartition(storeId);
  const displayIdentity = identity ?? presentationIdentity;
  if (!displayIdentity || (!storeId && firstPartition)) return <ReaderPending />;
  // The pending public presentation has no database. Keep that first mount
  // for its first verified identity only; subsequent partition changes still
  // reset the entire reader, adapter, deadlines and retry budget together.
  const key = !storeId || storeId === firstPartition
    ? `initial:${displayIdentity.siteSlug}` : storeId;
  return <ReaderSession key={key} storeId={storeId} identity={identity}
    displayIdentity={displayIdentity} cachedSnapshot={cachedSnapshot} scope={identity ? scope : displayIdentity.scope} />;
}

type StoreHostComponent = ComponentType<StoreHostProps>;

function ReaderSession({ identity, displayIdentity, scope, storeId, cachedSnapshot }: {
  cachedSnapshot?: StartupSnapshot | null;
  identity: WikiSessionIdentity | null;
  displayIdentity: WikiSessionIdentity;
  scope: WikiScope;
  storeId: string | null;
}) {
  // Once a store exists, its complete partition controls remounts. Refreshing an
  // equivalent identity must not change boot: LiveStore would restart the
  // provider and discard the mounted article. A new partition remounts us.
  const [initial, setInitial] = useState(() => cachedSnapshot ? startupInitialData(cachedSnapshot, location.pathname) : readInitialReaderData(displayIdentity));
  const [presenting] = useState(() => Boolean(initial));
  const [liveKit, setLiveKit] = useState<ReaderStoreKit>();
  const [handedOff, setHandedOff] = useState(false);
  const [initialExpired, setInitialExpired] = useState(false);
  const [stalled, setStalled] = useState(false);
  // The route this document was requested for: the store seeds the inlined
  // page for it, even if the reader navigated while the database opened.
  const [request] = useState(readerBootRequest);
  // A cached public page met a verified session (the caller keeps us mounted
  // only then). The session store starts empty: keep presenting the public page
  // while the running store syncs this route out of sight, then swap in one commit.
  const prepareHandoff = Boolean(presenting && identity && cachedSnapshot &&
    !sameStartupIdentity(cachedSnapshot.identity, identity) && keepsPresentationMounted(cachedSnapshot.identity, identity));
  const [handoffOutcome, setHandoffOutcome] = useState<ReaderHandoffOutcome | null>(null);
  const handoffStartedAt = useRef<number | null>(null);
  useEffect(() => {
    if (prepareHandoff && handoffStartedAt.current === null) handoffStartedAt.current = performance.now();
  }, [prepareHandoff]);
  const awaitingHandoff = prepareHandoff && !handoffOutcome;
  const runningKit = awaitingHandoff ? undefined : liveKit;
  const handOff = useCallback(() => {
    performance.mark("wiki-reader-live-handoff");
    markVisualPhase("reader-live-handoff");
    setHandedOff(true);
    setInitial(null);
  }, []);
  const publishStore = useCallback((kit: ReaderStoreKit | undefined) => {
    setLiveKit(kit);
    if (kit && !prepareHandoff) handOff();
  }, [handOff, prepareHandoff]);
  const handoffSettled = useRef(false);
  const settleHandoff = useCallback((outcome: Exclude<ReaderHandoffOutcome, "remount-required">) => {
    if (handoffSettled.current) return;
    handoffSettled.current = true;
    markSessionHandoff(outcome, handoffStartedAt.current ?? performance.now());
    setHandoffOutcome(outcome);
    handOff();
  }, [handOff]);
  useEffect(() => {
    if (!initial || handedOff) return;
    const timer = window.setTimeout(() => setInitialExpired(true), Math.max(0, initial.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [initial, handedOff]);

  // The store half loads once an identity is verified, and after this
  // component's first paint when a page is already presenting: evaluating
  // Effect and LiveStore must not hold the article's first frame.
  const [Host, setHost] = useState<StoreHostComponent | null>(null);
  const [hostError, setHostError] = useState<Error | null>(null);
  const verified = Boolean(identity && storeId);
  useEffect(() => {
    if (!verified || Host) return;
    let active = true;
    // A cold reader (no saved snapshot) will validate the manifest as soon as
    // its store opens: start that request now, after the first frame, while
    // the store downloads. A warm reader's store usually holds a fresh one.
    if (!cachedSnapshot && identity && !import.meta.env.VITE_WIKI_API_ORIGIN) {
      startEarlyRead(`/api/wiki/manifest?scope=${scope}&format=compact-v1`, "low");
    }
    markVisualPhase("store-module-start");
    loadStoreHost().then(module => { if (active) setHost(() => module.StoreHost); },
      (error: unknown) => { if (active) setHostError(error instanceof Error ? error : new Error(String(error))); });
    return () => { active = false; };
  }, [verified, Host, cachedSnapshot, identity, scope]);
  const [liveStoreDevtoolsEnabled] = useState(readLiveStoreDevtoolsEnabled);
  const [devtoolsFooterVisible] = useState(readDevtoolsFooterVisible);
  // A failed chunk takes the existing reload-once recovery path.
  if (hostError) throw hostError;
  const app = <ReaderApp identity={displayIdentity} scope={scope} storeId={storeId ?? ""}
    devtoolsFooterVisible={devtoolsFooterVisible} liveStoreDevtoolsEnabled={liveStoreDevtoolsEnabled} />;
  if (stalled) return <Suspense fallback={null}><StoreStartupRecovery /></Suspense>;
  const host = identity && storeId && Host ? (
    <Host identity={identity} storeId={storeId} scope={scope} cachedSnapshot={cachedSnapshot} request={request}
      presenting={presenting} app={presenting ? null : app} awaitingHandoff={awaitingHandoff}
      onPublish={publishStore} onHandoffSettled={settleHandoff} onStopped={setStalled} />
  ) : null;

  if (!presenting) return host ?? <ReaderPending />;
  return (
    <>
      {/* The host owns lifecycle only. A retry must not insert a second
          launching screen ahead of the already mounted reader. Errors still
          propagate, and shutdown switches the visible reader to recovery. */}
      <div hidden data-reader-cache-startup={Boolean(cachedSnapshot)}>{host}</div>
      <ReaderStoreContext.Provider value={runningKit ?? null}>
        <InitialReaderContext.Provider value={runningKit || handedOff || initialExpired ? null : initial}>
          {runningKit || (!handedOff && !initialExpired) ? app : <Suspense fallback={null}><StoreStartupRecovery /></Suspense>}
        </InitialReaderContext.Provider>
      </ReaderStoreContext.Provider>
    </>
  );
}

function ReaderApp({ identity, scope, storeId, devtoolsFooterVisible, liveStoreDevtoolsEnabled }: {
  identity: WikiSessionIdentity; scope: WikiScope; storeId: string;
  devtoolsFooterVisible: boolean; liveStoreDevtoolsEnabled: boolean;
}) {
  return (
    <WikiSessionProvider identity={identity}>
      <WikiScopeProvider scope={scope}>
        <WikiAuthProvider>
          <CanonicalRouteBoundary>
            <App
              devtoolsFooterVisible={devtoolsFooterVisible}
              liveStoreDevtoolsEnabled={liveStoreDevtoolsEnabled}
              storeId={storeId}
            />
          </CanonicalRouteBoundary>
        </WikiAuthProvider>
      </WikiScopeProvider>
    </WikiSessionProvider>
  );
}
