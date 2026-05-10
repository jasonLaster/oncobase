import { useStore } from "@livestore/react";
import {
  WikiMarkdown,
  type WikiMarkdownLinkProps,
  type WikiMarkdownNotificationAdapter,
} from "@diana-tnbc/wiki-markdown";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
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
import { useWikiScope } from "../wiki-context";
import { PageActions } from "./PageActions";
import { PageOutline } from "./PageOutline";

function routeLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return (
    <Link to={href ?? "#"} {...props}>
      {children}
    </Link>
  );
}

export function WikiPage({ onMetrics }: { onMetrics: (patch: MetricsPatch) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const scope = useWikiScope();
  const [toast, setToast] = useState<string | null>(null);
  const slug = slugFromPath(location.pathname);
  const routeRenderRef = useRef<{
    hadContent: boolean;
    recorded: boolean;
    slug: string;
    start: number;
  }>({
    hadContent: false,
    recorded: false,
    slug,
    start: performance.now(),
  });
  const page = useStore().store.useQuery(pageContentBySlug$(slug)) as PageContentRow | null;
  const index = useStore().store.useQuery(pageIndexBySlug$(slug)) as PageIndexRow | null;
  const siteState = useStore().store.useQuery(siteState$) as SiteStateRow | null;
  const stale = page?.contentStatus === "stale";
  const deleted = page?.contentStatus === "deleted";
  const tags = parseJsonArray<string>(page?.tagsJson ?? index?.tagsJson ?? "[]");
  const description = index?.description ?? null;
  const routeAdapter = useMemo(
    () => ({
      push: (href: string) => navigate(href),
    }),
    [navigate],
  );
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  }, []);
  const notification = useMemo<WikiMarkdownNotificationAdapter>(
    () => ({
      success: showToast,
      error: showToast,
    }),
    [showToast],
  );

  useEffect(() => {
    if (page?.content) {
      onMetrics({
        opfsBytes: null,
      });
      void storageEstimate().then((opfsBytes) => onMetrics({ opfsBytes }));
    }
  }, [onMetrics, page?.content, page?.size]);

  useEffect(() => {
    document.title = page?.title ? `${page.title} - Diana Wiki` : "Diana Wiki";
  }, [page?.title]);

  useEffect(() => {
    routeRenderRef.current = {
      hadContent: Boolean(page?.content),
      recorded: false,
      slug,
      start: performance.now(),
    };
  }, [slug]);

  useEffect(() => {
    const routeRender = routeRenderRef.current;
    if (!page?.content || routeRender.recorded || routeRender.slug !== slug) return;

    const elapsed = performance.now() - routeRender.start;
    routeRender.recorded = true;
    onMetrics({
      lastRouteRenderMs: elapsed,
      ...(routeRender.hadContent
        ? { warmRouteRenderMs: elapsed }
        : { coldRouteRenderMs: elapsed }),
    });
  }, [onMetrics, page?.content, slug]);

  if (deleted) {
    return (
      <article className="page-shell" data-test-id="document-article">
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
      <article className="page-shell" data-test-id="document-article">
        <h1>Page not found</h1>
        <p className="muted">No markdown body was returned for {slug}.</p>
      </article>
    );
  }

  if (!page?.content) {
    return (
      <article className="page-shell" data-test-id="document-article">
        <div className="loading-line" data-test-id="page-loading">
          <RefreshCwIcon size={16} aria-hidden="true" />
          Loading markdown for {index?.title ?? slug}
        </div>
      </article>
    );
  }

  return (
    <div className="page-layout">
      <article className="page-shell" data-test-id="document-article">
        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
        <nav className="breadcrumbs" aria-label="Breadcrumbs" data-test-id="breadcrumbs">
          <Link to="/">Home</Link>
          {slug.split("/").map((part, index, parts) => {
            const label = part.replace(/-/g, " ");
            const path = parts.slice(0, index + 1).join("/");
            return (
              <span key={path}>
                <span aria-hidden="true">/</span>
                <span>{label}</span>
              </span>
            );
          })}
        </nav>
        <header className="page-header">
          <div>
            <h1>{page.title}</h1>
            <p>{description ?? slug}</p>
          </div>
          <div className="page-badges">
            {stale ? <span className="badge updating">updating</span> : null}
            {page.sensitive ? <span className="badge sensitive">sensitive</span> : null}
            <span className="badge">{formatBytes(page.size)}</span>
          </div>
        </header>
        <PageActions
          content={page.content}
          contentHash={page.contentHash}
          scope={scope}
          slug={page.slug}
          title={page.title}
        />
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
          notification={notification}
          routeAdapter={routeAdapter}
        />
        <footer className="page-footer">
          <span>Manifest: {siteState?.generatedAt ?? "pending"}</span>
          <span>Content hash: {page.contentHash ?? "none"}</span>
          {page.expectedContentHash && page.expectedContentHash !== page.contentHash ? (
            <span>Expected hash: {page.expectedContentHash}</span>
          ) : null}
        </footer>
      </article>
      <PageOutline contentKey={`${page.slug}:${page.contentHash ?? "none"}`} />
    </div>
  );
}
