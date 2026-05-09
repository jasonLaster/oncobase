import { useStore } from "@livestore/react";
import { WikiMarkdown, type WikiMarkdownLinkProps } from "@diana-tnbc/wiki-markdown";
import { RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import {
  pageContentBySlug$,
  pageIndexBySlug$,
  siteState$,
} from "../livestore/queries";
import type {
  MetricsPatch,
  PageContentRow,
  PageIndexRow,
  SiteStateRow,
} from "../types";
import {
  formatBytes,
  parseJsonArray,
  slugFromPath,
  storageEstimate,
} from "../wiki-utils";

function routeLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return (
    <Link to={href ?? "#"} {...props}>
      {children}
    </Link>
  );
}

export function WikiPage({ onMetrics }: { onMetrics: (patch: MetricsPatch) => void }) {
  const location = useLocation();
  const slug = slugFromPath(location.pathname);
  const page = useStore().store.useQuery(pageContentBySlug$(slug)) as PageContentRow | null;
  const index = useStore().store.useQuery(pageIndexBySlug$(slug)) as PageIndexRow | null;
  const siteState = useStore().store.useQuery(siteState$) as SiteStateRow | null;
  const stale = page?.contentStatus === "stale";
  const deleted = page?.contentStatus === "deleted";
  const tags = parseJsonArray<string>(page?.tagsJson ?? index?.tagsJson ?? "[]");

  useEffect(() => {
    if (page?.content) {
      onMetrics({
        opfsBytes: null,
      });
      void storageEstimate().then((opfsBytes) => onMetrics({ opfsBytes }));
    }
  }, [onMetrics, page?.content, page?.size]);

  if (deleted) {
    return (
      <article className="page-shell">
        <h1>Page no longer available</h1>
        <p className="muted">
          The latest manifest no longer includes {slug}. The local body is kept
          only as deleted cache state and will not be rendered.
        </p>
      </article>
    );
  }

  if (page?.missingAt || page?.contentStatus === "missing") {
    return (
      <article className="page-shell">
        <h1>Page not found</h1>
        <p className="muted">No markdown body was returned for {slug}.</p>
      </article>
    );
  }

  if (!page?.content) {
    return (
      <article className="page-shell">
        <div className="loading-line">
          <RefreshCwIcon size={16} aria-hidden="true" />
          Loading markdown for {index?.title ?? slug}
        </div>
      </article>
    );
  }

  return (
    <article className="page-shell">
      <header className="page-header">
        <div>
          <h1>{page.title}</h1>
          <p>{slug}</p>
        </div>
        <div className="page-badges">
          {stale ? <span className="badge updating">updating</span> : null}
          {page.sensitive ? <span className="badge sensitive">sensitive</span> : null}
          <span className="badge">{formatBytes(page.size)}</span>
        </div>
      </header>
      {tags.length > 0 ? (
        <div className="tag-row">
          {tags.map((tag) => (
            <Link key={tag} to={`/?q=${encodeURIComponent(tag)}`}>
              {tag}
            </Link>
          ))}
        </div>
      ) : null}
      <WikiMarkdown
        content={page.content}
        currentSlug={page.slug}
        LinkComponent={routeLink}
      />
      <footer className="page-footer">
        <span>Manifest: {siteState?.generatedAt ?? "pending"}</span>
        <span>Content hash: {page.contentHash ?? "none"}</span>
        {page.expectedContentHash && page.expectedContentHash !== page.contentHash ? (
          <span>Expected hash: {page.expectedContentHash}</span>
        ) : null}
      </footer>
    </article>
  );
}
