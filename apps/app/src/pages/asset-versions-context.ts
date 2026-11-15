import { createContext } from "react";

/** Manifest asset hashes for the page being read (P11). */
export const AssetVersionsContext = createContext<ReadonlyMap<string, string>>(new Map());
