import { useStore } from "@livestore/react";
import {
  createWikiContentClient,
  expandCompactFileTree,
  flattenFileTree,
  type CompactFileNode,
  type FileNode,
  type WikiManifest,
  type WikiManifestPage,
  type WikiPageRecord,
  type WikiScope,
} from "@diana-tnbc/wiki-content";
import { WikiMarkdown, type WikiMarkdownLinkProps } from "@diana-tnbc/wiki-markdown";
import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DatabaseIcon,
  FileTextIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router";
import { events } from "./livestore/schema";
import {
  fileTree$,
  pageContentBySlug$,
  pageIndex$,
  pageIndexBySlug$,
  siteState$,
} from "./livestore/queries";

type Metrics = {
  status: "idle" | "syncing" | "ready" | "error";
  message: string;
  manifestBytes: number;
  markdownBytes: number;
  eventCount: number;
  opfsBytes: number | null;
  lastSyncMs: number | null;
};

type PageIndexRow = {
  slug: string;
  title: string;
  tagsJson: string;
  description: string | null;
  contentHash: string | null;
  sensitive: boolean;
  size: number;
};

type PageContentRow = {
  slug: string;
  title: string;
  content: string;
  tagsJson: string;
  contentHash: string | null;
  sensitive: boolean;
  size: number;
  fetchedAt: number;
  missingAt: number | null;
};

const WikiScopeContext = createContext<WikiScope>("public");
const RECENT_KEY = "wiki-vite-recent-slugs";

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

function useWikiScope() {
  return useContext(WikiScopeContext);
}

function slugFromPath(pathname: string) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\/+$/, "");
  return decoded || "index";
}

function hrefForSlug(slug: string) {
  return slug === "index" ? "/" : `/${slug}`;
}

function parseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function byteSize(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function formatBytes(value: number | null) {
  if (value == null) return "unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function readRecentSlugs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberSlug(slug: string) {
  const next = [slug, ...readRecentSlugs().filter((item) => item !== slug)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Best effort only.
  }
}

async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return estimate.usage ?? null;
}

function manifestToEvent(manifest: WikiManifest, receivedAt: number) {
  return events.manifestApplied({
    siteSlug: manifest.siteSlug,
    scope: manifest.scope,
    manifestHash: manifest.manifestHash,
    generatedAt: manifest.generatedAt,
    receivedAt,
    manifestSize: byteSize(JSON.stringify(manifest)),
    compactTreeJson: JSON.stringify(manifest.compactTree),
    pagesJson: JSON.stringify(manifest.pages),
    assetsJson: JSON.stringify(manifest.assets),
  });
}

function pageToEvent(page: WikiPageRecord) {
  return events.pageContentFetched({
    slug: page.slug,
    title: page.title,
    content: page.content,
    tags: page.tags,
    contentHash: page.contentHash,
    sensitive: page.sensitive,
    size: page.size,
    fetchedAt: Date.now(),
  });
}

function normalizeFetchedPageSlug(requestedSlug: string, pages: WikiPageRecord[]) {
  return pages.find((page) => page.slug === requestedSlug) ?? pages[0] ?? null;
}

function routeLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return (
    <Link to={href ?? "#"} {...props}>
      {children}
    </Link>
  );
}

export function App() {
  const scope = useWikiScope();
  const [metrics, setMetrics] = useState<Metrics>({
    status: "idle",
    message: "Waiting for LiveStore",
    manifestBytes: 0,
    markdownBytes: 0,
    eventCount: 0,
    opfsBytes: null,
    lastSyncMs: null,
  });

  const bumpMetrics = useCallback((patch: Partial<Metrics>) => {
    setMetrics((current) => ({
      ...current,
      ...patch,
      eventCount:
        patch.eventCount == null ? current.eventCount : current.eventCount + patch.eventCount,
      markdownBytes:
        patch.markdownBytes == null
          ? current.markdownBytes
          : current.markdownBytes + patch.markdownBytes,
    }));
  }, []);

  return (
    <>
      <WikiSync onMetrics={bumpMetrics} />
      <div className="prototype-shell">
        <Header scope={scope} metrics={metrics} />
        <div className="app-shell">
          <Sidebar />
          <main className="content-shell">
            <MetricsPanel metrics={metrics} />
            <Routes>
              <Route path="*" element={<WikiPage onMetrics={bumpMetrics} />} />
            </Routes>
          </main>
        </div>
        <MobileNav />
      </div>
    </>
  );
}

function WikiSync({ onMetrics }: { onMetrics: (patch: Partial<Metrics>) => void }) {
  const { store } = useStore();
  const scope = useWikiScope();
  const location = useLocation();
  const currentSlug = slugFromPath(location.pathname);
  const manifestRef = useRef<WikiManifest | null>(null);
  const inFlight = useRef(new Set<string>());
  const client = useMemo(() => createWikiContentClient({ scope }), [scope]);

  const fetchSlug = useCallback(
    async (slug: string, pageIndex?: WikiManifestPage) => {
      const cacheKey = `${scope}:${slug}`;
      if (inFlight.current.has(cacheKey)) return;

      const cached = store.query(pageContentBySlug$(slug)) as PageContentRow | null;
      if (
        cached?.content &&
        pageIndex &&
        cached.contentHash === pageIndex.contentHash
      ) {
        return;
      }

      inFlight.current.add(cacheKey);
      try {
        const batch = await client.fetchPages({ slugs: [slug] });
        const page = normalizeFetchedPageSlug(slug, batch.pages);
        if (page) {
          store.commit(pageToEvent(page));
          onMetrics({
            markdownBytes: page.size,
            eventCount: 1,
          });
        } else {
          store.commit(
            events.pageContentMissing({
              slug,
              contentHash: pageIndex?.contentHash ?? null,
              missingAt: Date.now(),
            }),
          );
          onMetrics({ eventCount: 1 });
        }
      } finally {
        inFlight.current.delete(cacheKey);
      }
    },
    [client, onMetrics, scope, store],
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const syncStart = performance.now();
      onMetrics({ status: "syncing", message: "Refreshing manifest" });
      try {
        const manifest = await client.fetchManifest();
        if (cancelled) return;
        manifestRef.current = manifest;
        const receivedAt = Date.now();
        store.commit(manifestToEvent(manifest, receivedAt));
        const manifestBySlug = new Map(manifest.pages.map((page) => [page.slug, page]));
        const currentPage = manifestBySlug.get(currentSlug);
        onMetrics({
          status: "ready",
          message: `Manifest ${manifest.manifestHash.slice(0, 8)} loaded`,
          manifestBytes: byteSize(JSON.stringify(manifest)),
          eventCount: 1,
          lastSyncMs: performance.now() - syncStart,
          opfsBytes: await storageEstimate(),
        });

        if (currentPage) {
          void fetchSlug(currentSlug, currentPage);
        }

        const treeSlugs = flattenFileTree(expandCompactFileTree(manifest.compactTree))
          .filter((node) => node.type === "file")
          .map((node) => node.slug);
        const recent = readRecentSlugs();
        const queue = [...new Set([currentSlug, ...treeSlugs.slice(0, 20), ...recent, ...manifest.pages.map((p) => p.slug)])]
          .filter((slug) => manifestBySlug.has(slug));

        scheduleEagerFetch(queue, manifestBySlug, fetchSlug);
      } catch (error) {
        if (!cancelled) {
          onMetrics({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [client, currentSlug, fetchSlug, onMetrics, store]);

  useEffect(() => {
    const manifest = manifestRef.current;
    if (!manifest) return;
    const page = manifest.pages.find((item) => item.slug === currentSlug);
    if (page) void fetchSlug(currentSlug, page);
  }, [currentSlug, fetchSlug]);

  useEffect(() => {
    if (currentSlug !== "index") rememberSlug(currentSlug);
  }, [currentSlug]);

  return null;
}

function scheduleEagerFetch(
  queue: string[],
  manifestBySlug: Map<string, WikiManifestPage>,
  fetchSlug: (slug: string, page: WikiManifestPage) => Promise<void>,
) {
  let index = 0;
  const runBatch = () => {
    const next = queue.slice(index, index + 6);
    index += next.length;
    void Promise.all(next.map((slug) => fetchSlug(slug, manifestBySlug.get(slug)!))).finally(() => {
      if (index >= queue.length) return;
      scheduleIdle(runBatch, 1500, 250);
    });
  };

  scheduleIdle(runBatch, 1000, 100);
}

function scheduleIdle(callback: () => void, timeout: number, fallbackDelay: number) {
  const requestIdleCallback = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout });
    return;
  }

  globalThis.setTimeout(callback, fallbackDelay);
}

function Header({ scope, metrics }: { scope: WikiScope; metrics: Metrics }) {
  return (
    <header className="topbar">
      <div className="header-left">
        <Link className="brand" to="/" aria-label="Home">
          <span className="brand-mark">D</span>
          <span className="brand-label">Diana Wiki</span>
        </Link>
      </div>
      <div className="header-center">
        <SearchBox />
      </div>
      <div className="topbar-status">
        <span className={`scope-pill ${scope === "session" ? "session" : ""}`}>
          {scope}
        </span>
        <span className={`sync-dot ${metrics.status}`} />
        <span>{metrics.message}</span>
      </div>
    </header>
  );
}

function SearchBox() {
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pages.slice(0, 8);
    return pages
      .filter((page) =>
        `${page.title} ${page.slug} ${page.tagsJson}`.toLowerCase().includes(normalized),
      )
      .slice(0, 12);
  }, [pages, query]);

  return (
    <div className="search-shell">
      <SearchIcon size={16} aria-hidden="true" />
      <input
        aria-label="Search cached pages"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) {
            navigate(hrefForSlug(results[0].slug));
            setQuery("");
          }
        }}
        placeholder="Search cached pages"
      />
      {query ? (
        <div className="search-results">
          {results.length === 0 ? (
            <div className="search-empty">No local matches</div>
          ) : (
            results.map((page) => (
              <Link
                key={page.slug}
                to={hrefForSlug(page.slug)}
                onClick={() => setQuery("")}
              >
                <FileTextIcon size={14} aria-hidden="true" />
                <span>{page.title}</span>
                <small>{page.slug}</small>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function useWikiTree() {
  const fileTreeRow = useStore().store.useQuery(fileTree$) as { treeJson: string } | null;
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  return useMemo(() => {
    if (fileTreeRow) {
      return expandCompactFileTree(parseJsonArray<CompactFileNode>(fileTreeRow.treeJson));
    }
    return pages.map((page) => ({
      name: page.slug.split("/").at(-1) ?? page.slug,
      slug: page.slug,
      type: "file" as const,
    }));
  }, [fileTreeRow, pages]);
}

function Sidebar() {
  const tree = useWikiTree();
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">File tree</div>
      <nav>
        {tree.map((node) => (
          <TreeNode key={node.slug} node={node} />
        ))}
      </nav>
    </aside>
  );
}

function pageTitleFromPath(pathname: string) {
  if (pathname === "/") return "Home";
  const slug = slugFromPath(pathname);
  return (slug.split("/").at(-1) ?? slug).replace(/-/g, " ");
}

function MobileNav() {
  const tree = useWikiTree();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        className="bottom-nav-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        <span>{pageTitleFromPath(location.pathname)}</span>
        <ChevronUpIcon size={16} aria-hidden="true" />
      </button>
      <div className={`bottom-nav-sheet ${open ? "open" : ""}`}>
        <button
          className="bottom-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={close}
        />
        <div className="bottom-nav-panel">
          <div className="bottom-nav-handle" aria-hidden="true" />
          <div className="bottom-nav-header">
            <strong>Pages</strong>
            <button type="button" onClick={close} aria-label="Close navigation">
              <XIcon size={16} aria-hidden="true" />
            </button>
          </div>
          <nav>
            {tree.map((node) => (
              <TreeNode key={node.slug} node={node} onNavigate={close} />
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

function TreeNode({
  node,
  depth = 0,
  onNavigate,
}: {
  node: FileNode;
  depth?: number;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(depth < 1);
  const active = location.pathname === hrefForSlug(node.slug);

  if (node.type === "directory") {
    return (
      <div>
        <button
          className="tree-directory"
          type="button"
          onClick={() => setOpen((value) => !value)}
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {open ? (
            <ChevronDownIcon size={14} aria-hidden="true" />
          ) : (
            <ChevronRightIcon size={14} aria-hidden="true" />
          )}
          <span>{node.name.replace(/-/g, " ")}</span>
        </button>
        {open
          ? node.children?.map((child) => (
              <TreeNode
                key={child.slug}
                node={child}
                depth={depth + 1}
                onNavigate={onNavigate}
              />
            ))
          : null}
      </div>
    );
  }

  if (node.type === "pdf") {
    return (
      <a
        className="tree-link pdf"
        href={`/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`}
        style={{ paddingLeft: depth * 12 + 24 }}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
      >
        {node.name.replace(/-/g, " ")}.pdf
      </a>
    );
  }

  return (
    <Link
      className={`tree-link ${active ? "active" : ""}`}
      style={{ paddingLeft: depth * 12 + 24 }}
      to={hrefForSlug(node.slug)}
      onClick={onNavigate}
    >
      {node.name.replace(/-/g, " ")}
    </Link>
  );
}

function WikiPage({ onMetrics }: { onMetrics: (patch: Partial<Metrics>) => void }) {
  const location = useLocation();
  const slug = slugFromPath(location.pathname);
  const page = useStore().store.useQuery(pageContentBySlug$(slug)) as PageContentRow | null;
  const index = useStore().store.useQuery(pageIndexBySlug$(slug)) as PageIndexRow | null;
  const siteState = useStore().store.useQuery(siteState$) as {
    manifestSize: number;
    generatedAt: string;
  } | null;
  const stale =
    Boolean(page?.content) &&
    Boolean(index?.contentHash) &&
    page?.contentHash !== index?.contentHash;
  const tags = parseJsonArray<string>(page?.tagsJson ?? index?.tagsJson ?? "[]");

  useEffect(() => {
    if (page?.content) {
      onMetrics({
        opfsBytes: null,
      });
      void storageEstimate().then((opfsBytes) => onMetrics({ opfsBytes }));
    }
  }, [onMetrics, page?.content, page?.size]);

  if (page?.missingAt) {
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
      </footer>
    </article>
  );
}

function MetricsPanel({ metrics }: { metrics: Metrics }) {
  return (
    <div className="metrics-panel">
      <div>
        <DatabaseIcon size={14} aria-hidden="true" />
        <span>manifest</span>
        <strong>{formatBytes(metrics.manifestBytes)}</strong>
      </div>
      <div>
        <FileTextIcon size={14} aria-hidden="true" />
        <span>markdown</span>
        <strong>{formatBytes(metrics.markdownBytes)}</strong>
      </div>
      <div>
        <ActivityIcon size={14} aria-hidden="true" />
        <span>events</span>
        <strong>{metrics.eventCount}</strong>
      </div>
      <div>
        <DatabaseIcon size={14} aria-hidden="true" />
        <span>storage</span>
        <strong>{formatBytes(metrics.opfsBytes)}</strong>
      </div>
    </div>
  );
}
