import { useStore } from "@livestore/react";
import {
  WikiMarkdown,
  type WikiMarkdownLinkProps,
  type WikiMarkdownNotificationAdapter,
} from "@oncobase/wiki-markdown";
import {
  DocumentOutlineShell,
  WikiCopyPageButton,
  WikiEmptyState,
  WikiPageActionButton,
  WikiPageHeader,
  WikiPageSkeleton,
  WikiTagList,
  WikiToast,
} from "@oncobase/wiki-shell";
import { LockIcon } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WikiMermaidGanttMarker } from "@oncobase/wiki-markdown/mermaid";
import { Link, useLocation, useNavigate } from "react-router";
import { pageContentBySlug$, pageIndexBySlug$ } from "../livestore/queries";
import type {
  Metrics,
  MetricsPatch,
  PageContentRow,
  PageIndexRow,
} from "../types";
import { parseJsonArray, slugFromPath, storageSnapshot } from "../wiki-utils";
import { RETRY_PAGE_EVENT } from "../sync/WikiSync";
import { wikiViteSmartTableLayoutAdapter } from "../shell/smart-table-layout-adapter";

const WIKI_GANTT_MARKERS: WikiMermaidGanttMarker[] = [
  { date: "2026-07-14", label: "Phase 2 (12 weeks)" },
  { date: "2026-09-10", label: "Surgery" },
];

const WIKI_GANTT_REFERENCE_YEAR = 2026;

const MERMAID_FENCE_PATTERN = /^\s*```mermaid\s*$/m;

const LazyMermaidRenderer = lazy(() =>
  import("@oncobase/wiki-markdown/mermaid").then((module) => ({
    default: module.WikiMermaidRenderer,
  })),
);

// Build-time flag injected by vite.config `define`. When comments are enabled
// the reader renders the shared Liveblocks comments rail; otherwise (and in the
// pinned e2e suite) it renders the plain outline rail.
declare const __WIKI_COMMENTS_ENABLED__: boolean;

// Gate the dynamic import on the build flag so a comments-OFF build dead-code
// eliminates the entire comments graph (Liveblocks JS + CSS) — keeping the
// eager bundle within budget. A comments-ON build loads it as a lazy chunk.
const LazyDocumentComments = __WIKI_COMMENTS_ENABLED__
  ? lazy(() =>
      import("@oncobase/wiki-comments").then((module) => ({
        default: module.ActiveDocumentComments,
      })),
    )
  : null;

function MermaidRendererSlot({ content }: { content: string }) {
  if (!MERMAID_FENCE_PATTERN.test(content)) return null;
  return (
    <Suspense fallback={null}>
      <LazyMermaidRenderer
        ganttAxisReferenceYear={WIKI_GANTT_REFERENCE_YEAR}
        ganttMarkers={WIKI_GANTT_MARKERS}
      />
    </Suspense>
  );
}

function routeLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return (
    <Link to={href ?? "#"} {...props}>
      {children}
    </Link>
  );
}

export function WikiPage({
  metrics,
  onMetrics,
}: {
  metrics: Metrics;
  onMetrics: (patch: MetricsPatch) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
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
  const deleted = page?.contentStatus === "deleted";
  const failedCurrentFetch =
    !page?.content &&
    Boolean(index) &&
    metrics.status === "error" &&
    metrics.message.includes(slug);
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
      void storageSnapshot().then((storage) =>
        onMetrics({
          opfsBytes: storage.usage,
          storageQuotaBytes: storage.quota,
          storagePressure: storage.pressure,
        }),
      );
    }
  }, [onMetrics, page?.content, page?.size]);

  useEffect(() => {
    document.title = page?.title ? `${page.title} - Diana Wiki` : "Diana Wiki";
    const descriptionMeta =
      document.querySelector<HTMLMetaElement>('meta[name="description"]') ??
      document.head.appendChild(document.createElement("meta"));
    descriptionMeta.name = "description";
    descriptionMeta.content =
      description ?? page?.title ?? "Diana TNBC wiki reader";
  }, [description, page?.title]);

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
      <WikiEmptyState
        data-test-id="document-article"
        title="Page no longer available"
        description={`The latest manifest no longer includes ${slug}. The local body is kept only as deleted cache state and will not be rendered.`}
      />
    );
  }

  if (page?.missingAt || page?.contentStatus === "missing") {
    return (
      <WikiEmptyState
        data-test-id="document-article"
        title="Page not found"
        description={`The latest manifest does not include markdown for ${slug}. This reader can keep using cached pages while the backend catches up.`}
        actions={
          <>
            <Link className="wiki-shell-page-action page-action" to="/">
              Go home
            </Link>
            <WikiPageActionButton
              onClick={() => window.dispatchEvent(new Event(RETRY_PAGE_EVENT))}
            >
              Retry
            </WikiPageActionButton>
          </>
        }
      />
    );
  }

  if (!page?.content) {
    if (failedCurrentFetch) {
      return (
        <WikiEmptyState
          data-test-id="document-article"
          title={index?.title ?? "Markdown unavailable"}
          description="The page is in the local manifest, but its markdown body could not be fetched. Cached pages remain available while this request is retried."
          actions={
            <WikiPageActionButton
              data-test-id="retry-page-fetch"
              onClick={() => window.dispatchEvent(new Event(RETRY_PAGE_EVENT))}
            >
              Retry
            </WikiPageActionButton>
          }
        />
      );
    }

    if (metrics.status === "error") {
      return (
        <WikiEmptyState
          data-test-id="document-article"
          title={index?.title ?? "Markdown unavailable"}
          description={metrics.message || "The page could not be loaded from the wiki backend."}
          actions={
            <WikiPageActionButton
              data-test-id="retry-page-fetch"
              onClick={() => window.dispatchEvent(new Event(RETRY_PAGE_EVENT))}
            >
              Retry
            </WikiPageActionButton>
          }
        />
      );
    }

    return (
      <article className="page-shell" data-test-id="document-article">
        <WikiPageSkeleton
          data-test-id="page-loading"
          includeTags
          label={`Loading ${index?.title ?? slug}`}
        />
      </article>
    );
  }

  const readerBody = (
    <>
      {toast ? <WikiToast>{toast}</WikiToast> : null}
      <WikiPageHeader
        title={page.title}
        badges={
          <>
            {page.sensitive ? (
              <span
                aria-label="Sensitive page"
                title="Sensitive page"
                className="wiki-shell-sensitive-lock"
              >
                <LockIcon aria-hidden size={16} strokeWidth={1.8} />
              </span>
            ) : null}
            <WikiCopyPageButton
              slug={page.slug}
              title={page.title}
              contentHash={page.contentHash ?? undefined}
            />
          </>
        }
      />
      <WikiTagList
        tags={tags}
        renderTag={(tag) => (
          <Link key={tag} to={`/?q=${encodeURIComponent(tag)}`}>
            {tag}
          </Link>
        )}
      />
      <WikiMarkdown
        content={page.content}
        currentSlug={page.slug}
        LinkComponent={routeLink}
        notification={notification}
        routeAdapter={routeAdapter}
        tableLayoutAdapter={wikiViteSmartTableLayoutAdapter}
      />
      <MermaidRendererSlot content={page.content} />
    </>
  );

  const outlineShell = (
    <DocumentOutlineShell
      articleClassName="page-shell"
      contentKey={`${page.slug}:${page.contentHash ?? "none"}`}
      documentSlug={page.slug}
      documentTitle={page.title}
      pathname={location.pathname}
    >
      {readerBody}
    </DocumentOutlineShell>
  );

  if (__WIKI_COMMENTS_ENABLED__ && LazyDocumentComments) {
    return (
      <Suspense fallback={outlineShell}>
        <LazyDocumentComments documentSlug={page.slug} documentTitle={page.title}>
          {readerBody}
        </LazyDocumentComments>
      </Suspense>
    );
  }

  return outlineShell;
}
