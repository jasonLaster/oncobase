import { lazy, Suspense } from "react";
import { useReaderStore } from "../bootstrap/reader-queries";
import { recordWebMcpCall } from "../reader-telemetry";
import { useWikiScope, useWikiSession } from "../wiki-context";
import { contentSlugFromRouteSlug, readRecentSlugs, slugFromPath } from "../wiki-utils";
import { webMcpAvailable } from "./webmcp-flag";

// The reader's WebMCP tools load only in browsers that expose the API. This
// eager wrapper hands the lazy module everything it needs from the reader's
// startup graph, so that module imports none of it: a module shared between
// the lazy tools and the eager shell would be split into extra eager chunks.
const ReaderWebMcp = lazy(() => import("./ReaderWebMcp").then((module) => ({ default: module.ReaderWebMcp })));

const routeContentSlug = (pathname: string) => contentSlugFromRouteSlug(slugFromPath(pathname));

export function ReaderAgentTools() {
  const store = useReaderStore();
  const scope = useWikiScope();
  const signedIn = Boolean(useWikiSession()?.authenticated);
  if (!store || !webMcpAvailable()) return null;
  return (
    <Suspense fallback={null}>
      <ReaderWebMcp
        store={store}
        scope={scope}
        signedIn={signedIn}
        recentSlugs={readRecentSlugs}
        routeContentSlug={routeContentSlug}
        onCall={recordWebMcpCall}
      />
    </Suspense>
  );
}
