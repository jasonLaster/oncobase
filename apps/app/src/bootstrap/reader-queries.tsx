import type { LiveQueryDef } from "@livestore/livestore";
import type { LiveStoreContext } from "@livestore/react";
import { createContext, useContext, useMemo, useSyncExternalStore, type ComponentType, type ContextType, type ReactNode } from "react";
import type { InitialReaderData } from "./initial-reader-data";

// Paint-critical module: type imports only from LiveStore. The store chunk
// (livestore/StoreHost.tsx) supplies the running store, its query
// definitions and events through ReaderStoreContext once the database is open,
// so the shell and article render without downloading Effect or LiveStore.
export type ReaderQueries = typeof import("../livestore/queries");
export type ReaderEvents = typeof import("../livestore/schema").events;
export type RunningLiveStoreContext = NonNullable<ContextType<typeof LiveStoreContext>>;
export type ReaderStore = RunningLiveStoreContext["store"];
export type ReaderStoreKit = {
  context: RunningLiveStoreContext;
  store: ReaderStore;
  queries: ReaderQueries;
  events: ReaderEvents;
  /** Provides LiveStore's own context for store-side components (useStore). */
  Scope: ComponentType<{ children: ReactNode }>;
};

export const InitialReaderContext = createContext<InitialReaderData | null>(null);
export const ReaderStoreContext = createContext<ReaderStoreKit | null>(null);
export const useInitialReaderData = () => useContext(InitialReaderContext);
export const useReaderStoreKit = () => useContext(ReaderStoreContext);
export const useReaderStore = () => useContext(ReaderStoreContext)?.store;

/** A query named without its definition: the definition is built from the
 * store chunk's queries module, so naming it costs no LiveStore code. `key`
 * identifies equivalent queries across renders. */
export type ReaderQueryRef = { key: string; select: (queries: ReaderQueries) => LiveQueryDef<any> };

export const readerQuery = {
  pageIndex: { key: "pageIndex", select: q => q.pageIndex$ },
  fileTree: { key: "fileTree", select: q => q.fileTree$ },
  sidebarTree: { key: "sidebarTree", select: q => q.sidebarTree$ },
  assets: { key: "assets", select: q => q.assets$ },
  siteState: { key: "siteState", select: q => q.siteState$ },
  pageIndexBySlug: (slug: string): ReaderQueryRef => ({ key: `pageIndex:${slug}`, select: q => q.pageIndexBySlug$(slug) }),
  pageContentBySlug: (slug: string): ReaderQueryRef => ({ key: `pageContent:${slug}`, select: q => q.pageContentBySlug$(slug) }),
} satisfies Record<string, ReaderQueryRef | ((slug: string) => ReaderQueryRef)>;

/** Subscribe through LiveStore's public query API. The optional initial value
 * is presentation data only, and stops being used as soon as a store exists.
 * Keeping this hook mounted preserves the reader's controls during handoff. */
export function useReaderQuery<T>(ref: ReaderQueryRef, initial: NoInfer<T> | null): T | null {
  const kit = useReaderStoreKit();
  const source = useMemo(() => {
    const query = kit ? ref.select(kit.queries) as LiveQueryDef<T> : null;
    let value: T | null = kit && query ? kit.store.query(query) : initial;
    return {
      getSnapshot: () => value,
      subscribe: (notify: () => void) => kit && query ? kit.store.subscribe(query, {
        onUpdate: next => { value = next; notify(); },
      }) : () => {},
    };
    // LiveStore keys query resources by the definition's stable hash, and the
    // ref key names the same query. Recreating equivalent refs must not
    // resubscribe forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, ref.key, initial]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

/** Store-side components (useStore) need LiveStore's own context. Rendered
 * only once a store exists, and never wraps the article itself, so attaching
 * the store does not remount the reader. */
export function StoreScoped({ children }: { children: ReactNode }) {
  const kit = useReaderStoreKit();
  return kit ? <kit.Scope>{children}</kit.Scope> : null;
}

export const EMPTY_READER_ROWS: never[] = [];
