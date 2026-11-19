import { readerQuery, useInitialReaderData, useReaderQuery, EMPTY_READER_ROWS } from "./bootstrap/reader-queries";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router";
import {
  canonicalRoutePathname,
  canonicalSlugMap,
} from "./route-canonicalization";
import type { PageIndexRow } from "./types";

type RedirectLookup = (pathname: string) => string | null;

// The legacy redirect table is ~4 KiB gzip. The server already redirects a
// cold load of a legacy URL, so the reader fetches the table after paint and
// applies it to later in-app navigation.
let loadedRedirects: RedirectLookup | null = null;
let redirectsRequest: Promise<RedirectLookup | null> | null = null;

function loadConfiguredRedirects() {
  redirectsRequest ??= import("./configured-redirects")
    .then(({ configuredRedirectPathname }) => (loadedRedirects = configuredRedirectPathname))
    .catch(() => {
      redirectsRequest = null;
      return null;
    });
  return redirectsRequest;
}

function useConfiguredRedirects() {
  const [redirects, setRedirects] = useState(() => loadedRedirects);
  useEffect(() => {
    if (redirects) return;
    let active = true;
    void loadConfiguredRedirects().then((lookup) => {
      if (active && lookup) setRedirects(() => lookup);
    });
    return () => {
      active = false;
    };
  }, [redirects]);
  return redirects ?? undefined;
}

export function CanonicalRouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const initial = useInitialReaderData();
  const pages = useReaderQuery(readerQuery.pageIndex, initial?.pages ?? EMPTY_READER_ROWS) as PageIndexRow[];
  const configuredRedirects = useConfiguredRedirects();
  const canonicalSlugs = useMemo(
    () => canonicalSlugMap(pages.map((page) => page.slug)),
    [pages],
  );
  const canonicalPathname = canonicalRoutePathname(
    location.pathname,
    canonicalSlugs,
    configuredRedirects,
  );

  if (canonicalPathname) {
    return (
      <Navigate
        replace
        to={{
          pathname: canonicalPathname,
          search: location.search,
          hash: location.hash,
        }}
      />
    );
  }

  return children;
}
