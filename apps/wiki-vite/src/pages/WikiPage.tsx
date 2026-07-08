import { useStore } from "@livestore/react";
import {
  WikiMarkdown,
  type WikiMarkdownLinkProps,
  type WikiMarkdownNotificationAdapter,
} from "@oncobase/wiki-markdown";
import {
  DocumentOutlineShell,
  WikiBadge,
  WikiBreadcrumbs,
  WikiEmptyState,
  WikiPageActionButton,
  WikiPageFooter,
  WikiPageHeader,
  WikiPageLoading,
  WikiSensitiveUnavailable,
  WikiSourceLinks,
  WikiStatusNotice,
  WikiTagList,
  WikiToast,
  type WikiBreadcrumbItem,
} from "@oncobase/wiki-shell";
import {
  Suspense,
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WikiMermaidGanttMarker } from "@oncobase/wiki-markdown/mermaid";
import { Link, useLocation, useNavigate } from "react-router";
import {
  assets$,
  pageContentBySlug$,
  pageIndex$,
  pageIndexBySlug$,
  siteState$,
} from "../livestore/queries";
import type {
  AssetIndexRow,
  Metrics,
  MetricsPatch,
  PageContentRow,
  PageIndexRow,
  SiteStateRow,
} from "../types";
import {
  formatBytes,
  hrefForSlug,
  parseJsonArray,
  slugFromPath,
  storageSnapshot,
} from "../wiki-utils";
import { useWikiScope, useWikiSession } from "../wiki-context";
import { assetFileName, assetHref, relatedAssetsForSlug } from "../wiki-assets";
import { RETRY_PAGE_EVENT } from "../sync/WikiSync";
import { wikiViteSmartTableLayoutAdapter } from "../shell/smart-table-layout-adapter";
import { PageActions } from "./PageActions";

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
const LazyDocumentComments = lazy(() =>
  import("@oncobase/wiki-comments/wrapper").then((module) => ({
    default: module.DocumentComments,
  })),
);

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

function formatBreadcrumbLabel(part: string) {
  return part.replace(/-/g, " ");
}

function buildBreadcrumbItems({
  pageSlugs,
  slug,
  title,
}: {
  pageSlugs?: Set<string>;
  slug?: string;
  title?: string;
}): WikiBreadcrumbItem[] {
  const parts = slug?.split("/").filter(Boolean) ?? [];
  const items: WikiBreadcrumbItem[] = [{ href: "/", key: "home", label: "Home" }];

  parts.forEach((part, index) => {
    const path = parts.slice(0, index + 1).join("/");
    const isCurrent = index === parts.length - 1;
    const label = isCurrent && title ? title : formatBreadcrumbLabel(part);
    items.push({
      current: isCurrent,
      href: !isCurrent && pageSlugs?.has(path) ? hrefForSlug(path) : undefined,
      key: path,
      label,
    });
  });

  return items;
}

function Breadcrumbs(props: {
  pageSlugs?: Set<string>;
  slug?: string;
  title?: string;
}) {
  return (
    <WikiBreadcrumbs
      data-test-id="breadcrumbs"
      items={buildBreadcrumbItems(props)}
      renderLink={(item) => <Link to={item.href ?? "#"}>{item.label}</Link>}
    />
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
  const scope = useWikiScope();
  const identity = useWikiSession();
  const [toast, setToast] = useState<string | null>(null);
  const slug = slugFromPath(location.pathname);
  const deferredSlug = useDeferredValue(slug);
  const routePending = deferredSlug !== slug;
  const page = useStore().store.useQuery(pageContentBySlug$(deferredSlug)) as PageContentRow | null;
  const index = useStore().store.useQuery(pageIndexBySlug$(deferredSlug)) as PageIndexRow | null;
  const routeIndex = useStore().store.useQuery(pageIndexBySlug$(slug)) as PageIndexRow | null;
  const pageIndex = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const assets = useStore().store.useQuery(assets$) as AssetIndexRow[];
  const siteState = useStore().store.useQuery(siteState$) as SiteStateRow | null;
  const stale = page?.contentStatus === "stale";
  const deleted = page?.contentStatus === "deleted";
  const failedCurrentFetch =
    !page?.content &&
    Boolean(index) &&
    metrics.status === "error" &&
    metrics.message.includes(slug);
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
  if (routeRenderRef.current.slug !== slug) {
    routeRenderRef.current = {
      hadContent: Boolean(page?.content && page.slug === slug),
      recorded: false,
      slug,
      start: performance.now(),
    };
  }
  const tags = parseJsonArray<string>(page?.tagsJson ?? index?.tagsJson ?? "[]");
  const relatedAssets = useMemo(
    () => relatedAssetsForSlug(deferredSlug, assets).slice(0, 6),
    [assets, deferredSlug],
  );
  const pageSlugs = useMemo(
    () => new Set(pageIndex.map((page) => page.slug)),
    [pageIndex],
  );
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
    const routeRender = routeRenderRef.current;
    if (!page?.content || page.slug !== slug || routeRender.recorded || routeRender.slug !== slug) {
      return;
    }

    const elapsed = performance.now() - routeRender.start;
    routeRender.recorded = true;
    onMetrics({
      lastRouteRenderMs: elapsed,
      ...(routeRender.hadContent
        ? { warmRouteRenderMs: elapsed }
        : { coldRouteRenderMs: elapsed }),
    });
  }, [onMetrics, page?.content, page?.slug, slug]);

  if (routePending) {
    return (
      <article
        className="page-shell"
        data-navigation-pending="true"
        data-test-id="document-article"
      >
        <Breadcrumbs pageSlugs={pageSlugs} slug={slug} title={routeIndex?.title} />
        <WikiPageLoading
          data-test-id="page-loading"
          label={`Opening ${routeIndex?.title ?? slug}`}
        />
      </article>
    );
  }

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
        before={<Breadcrumbs />}
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

  if (page?.contentStatus === "sensitive-unavailable") {
    return (
      <WikiSensitiveUnavailable
        before={<Breadcrumbs pageSlugs={pageSlugs} slug={slug} title={page.title} />}
        data-test-id="document-article"
        signedIn={identity?.authenticated === true}
        actions={
          <>
            {identity?.authenticated !== true ? (
              <Link
                className="wiki-shell-page-action page-action"
                to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`}
              >
                Sign in
              </Link>
            ) : null}
            <Link className="wiki-shell-page-action page-action" to="/">
              Go home
            </Link>
          </>
        }
      />
    );
  }

  if (!page?.content) {
    if (failedCurrentFetch) {
      return (
        <WikiEmptyState
          before={<Breadcrumbs pageSlugs={pageSlugs} slug={slug} title={index?.title} />}
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
          before={<Breadcrumbs pageSlugs={pageSlugs} slug={slug} title={index?.title} />}
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
        <WikiPageLoading
          data-test-id="page-loading"
          label={`Loading markdown for ${index?.title ?? slug}`}
        />
      </article>
    );
  }

  const pageBadges = (
    <>
      {stale ? <WikiBadge variant="updating">updating</WikiBadge> : null}
      {page.sensitive ? <WikiBadge variant="sensitive">sensitive</WikiBadge> : null}
      <WikiBadge>{formatBytes(page.size)}</WikiBadge>
    </>
  );

  const pageBody = (
    <>
      {toast ? <WikiToast>{toast}</WikiToast> : null}
      <Breadcrumbs pageSlugs={pageSlugs} slug={slug} title={page.title} />
      <WikiPageHeader title={page.title} description={description ?? slug} badges={pageBadges} />
      {stale ? (
        <WikiStatusNotice>
          Showing cached markdown while a newer version is fetched in the background.
        </WikiStatusNotice>
      ) : null}
      <PageActions
        content={page.content}
        contentHash={page.contentHash}
        scope={scope}
        slug={page.slug}
        title={page.title}
      />
      <WikiSourceLinks
        data-test-id="source-links"
        items={relatedAssets.map((asset) => ({
          href: assetHref(asset.path),
          key: asset.path,
          kind: asset.kind === "pdf" ? "PDF" : "File",
          label: assetFileName(asset.path),
        }))}
        renderLink={(asset, children) => (
          <a href={asset.href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )}
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
      <WikiPageFooter
        items={[
          `Manifest: ${siteState?.generatedAt ?? "pending"}`,
          `Content hash: ${page.contentHash ?? "none"}`,
          page.expectedContentHash && page.expectedContentHash !== page.contentHash
            ? `Expected hash: ${page.expectedContentHash}`
            : null,
        ].filter(Boolean)}
      />
    </>
  );

  const commentsFallback = (
    <DocumentOutlineShell
      articleClassName="page-shell"
      contentKey={`${page.slug}:${page.contentHash ?? "none"}`}
      documentSlug={page.slug}
      documentTitle={page.title}
      pathname={location.pathname}
    >
      {pageBody}
    </DocumentOutlineShell>
  );

  return (
    <Suspense fallback={commentsFallback}>
      <LazyDocumentComments
        articleClassName="page-shell"
        contentKey={`${page.slug}:${page.contentHash ?? "none"}`}
        documentSlug={page.slug}
        documentTitle={page.title}
        pathname={location.pathname}
      >
        {pageBody}
      </LazyDocumentComments>
    </Suspense>
  );
}
