import type { WikiScope, WikiSessionIdentity } from "@oncobase/wiki-content";
import { createContext, useContext, type ReactNode } from "react";

const WikiScopeContext = createContext<WikiScope>("public");
const WikiSessionContext = createContext<WikiSessionIdentity | null>(null);

export function WikiScopeProvider({
  children,
  scope,
}: {
  children: ReactNode;
  scope: WikiScope;
}) {
  return (
    <WikiScopeContext.Provider value={scope}>
      {children}
    </WikiScopeContext.Provider>
  );
}

export function WikiSessionProvider({
  children,
  identity,
}: {
  children: ReactNode;
  identity: WikiSessionIdentity;
}) {
  return (
    <WikiSessionContext.Provider value={identity}>
      {children}
    </WikiSessionContext.Provider>
  );
}

export function useWikiScope() {
  return useContext(WikiScopeContext);
}

export function useWikiSession() {
  return useContext(WikiSessionContext);
}
