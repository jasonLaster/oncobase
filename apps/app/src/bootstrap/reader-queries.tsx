import type { LiveQueryDef } from "@livestore/livestore";
import { LiveStoreContext } from "@livestore/react";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { InitialReaderData } from "./initial-reader-data";

export const InitialReaderContext = createContext<InitialReaderData | null>(null);
export const useInitialReaderData = () => useContext(InitialReaderContext);
export const useReaderStore = () => useContext(LiveStoreContext)?.store;

/** Subscribe through LiveStore's public query API. The optional initial value
 * is presentation data only, and stops being used as soon as a store exists.
 * Keeping this hook mounted preserves the reader's controls during handoff. */
export function useReaderQuery<T>(query: LiveQueryDef<T>, initial: NoInfer<T> | null): T | null {
  const store = useReaderStore();
  const source = useMemo(() => {
    let value: T | null = store ? store.query(query) : initial;
    return {
      getSnapshot: () => value,
      subscribe: (notify: () => void) => store ? store.subscribe(query, {
        onUpdate: next => { value = next; notify(); },
      }) : () => {},
    };
    // LiveStore itself keys query resources by the definition's stable hash.
    // Recreating equivalent route query objects must not resubscribe forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, query.hash, initial]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

export const EMPTY_READER_ROWS: never[] = [];
