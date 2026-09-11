import { useStore } from "@livestore/react";
import type {
  WikiScope,
  WikiSessionIdentity,
} from "@oncobase/wiki-content";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { PageContentRow, PageIndexRow, SiteStateRow } from "../types";
import { contentSlugFromRouteSlug, slugFromPath } from "../wiki-utils";
import {
  isCurrentReaderHydrated,
  isCurrentReaderManifestValidated,
  isRouteUnavailableInCurrentReader,
  retirePreviousReaderStore,
} from "./cache-retirement";
import {
  fileTree$,
  pageContentBySlug$,
  pageIndexBySlug$,
  siteState$,
} from "./queries";


export function ReaderCacheRetirement({
  identity,
  scope,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
}) {
  const { store } = useStore();
  const location = useLocation();
  const slug = contentSlugFromRouteSlug(slugFromPath(location.pathname));
  const state = store.useQuery(siteState$) as SiteStateRow | null;
  const page = store.useQuery(pageContentBySlug$(slug)) as PageContentRow | null;
  const index = store.useQuery(pageIndexBySlug$(slug)) as PageIndexRow | null;
  const fileTree = store.useQuery(fileTree$) as { treeJson: string } | null;
  const retirementStarted = useRef(false);

  useEffect(() => {
    if (scope !== "public" || !fileTree || retirementStarted.current) return;
    const validated = isCurrentReaderManifestValidated({ identity, scope, state });
    const ready = isCurrentReaderHydrated({ identity, state, page, scope });
    const unavailable = isRouteUnavailableInCurrentReader({ index, page });
    if (!validated || (!ready && !unavailable)) return;
    retirementStarted.current = true;
    void retirePreviousReaderStore({ identity, origin: window.location.origin, scope });
  }, [fileTree, identity, index, page, scope, state]);

  return null;
}
