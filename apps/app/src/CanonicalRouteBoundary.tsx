import { useInitialReaderData, useReaderQuery, EMPTY_READER_ROWS } from "./bootstrap/reader-queries";
import { type ReactNode, useMemo } from "react";
import { Navigate, useLocation } from "react-router";
import { pageIndex$ } from "./livestore/queries";
import {
  canonicalRoutePathname,
  canonicalSlugMap,
} from "./route-canonicalization";
import type { PageIndexRow } from "./types";

export function CanonicalRouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const initial = useInitialReaderData();
  const pages = useReaderQuery(pageIndex$, initial?.pages ?? EMPTY_READER_ROWS) as PageIndexRow[];
  const canonicalSlugs = useMemo(
    () => canonicalSlugMap(pages.map((page) => page.slug)),
    [pages],
  );
  const canonicalPathname = canonicalRoutePathname(
    location.pathname,
    canonicalSlugs,
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
