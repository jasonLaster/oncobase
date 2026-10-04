import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Dna,
  Menu,
  Network,
  Search,
  X,
} from "lucide-react";
import type {
  WikiManifest,
  WikiManifestPage,
  WikiPageBatch,
} from "@oncobase/wiki-content";
import { canonicalSlugLookupEntriesFromSlugs } from "@oncobase/wiki-content/canonical-slugs";
import {
  MarkdownTitle,
  WikiMarkdown,
  type WikiMarkdownLinkProps,
} from "@oncobase/wiki-markdown/browser";
import { markdownTitleToText } from "@oncobase/wiki-markdown/title";
import { isEducationSlug } from "../education-access";
import {
  EDUCATION_PREFIX,
  educationHref,
  educationLinkHref,
  educationSlugFromPathname,
} from "../education-routes";
import { updateClientRouteMetadata } from "../document-title";
import { PublicThemeControl } from "../PublicThemeControl";
import "./education.css";

const MermaidRenderer = lazy(() =>
  import("@oncobase/wiki-markdown/mermaid").then((module) => ({
    default: module.WikiMermaidRenderer,
  })),
);
const EMPTY_PAGES: WikiManifestPage[] = [];
type SearchResult = {
  slug: string;
  title: string;
  excerpt?: string;
  matches?: Array<{ lineContent: string }>;
};
type SearchResponse = {
  results: SearchResult[];
  complete?: boolean;
  retryAfterMs?: number;
};

/** Education never opens the care reader's database or browser snapshots. */
function useEducationResource<T>(url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: T;
    error?: string;
    partial?: boolean;
  }>({ key: "" });
  const key = `${url}:${attempt}`;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const read = async () => {
      try {
        const response = await fetch(url, {
          credentials: "omit",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        if (!response.ok)
          throw new Error(
            "This content could not be loaded. Please try again.",
          );
        const data = (await response.json()) as T;
        const progress = data as { complete?: boolean; retryAfterMs?: number };
        const partial =
          response.headers.get("X-Wiki-Manifest-Partial") === "true" ||
          progress.complete === false;
        if (controller.signal.aborted) return;
        setState({ key, data, partial });
        if (partial && polls++ < 15)
          timer = setTimeout(
            read,
            Math.max(500, Math.min(progress.retryAfterMs ?? 2000, 5000)),
          );
      } catch {
        if (!controller.signal.aborted)
          setState((current) => ({
            key,
            data: current.key === key ? current.data : undefined,
            error: "This content could not be loaded. Please try again.",
          }));
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, key]);
  return {
    ...(state.key === key ? state : {}),
    loading: Boolean(
      url && (state.key !== key || (!state.data && !state.error)),
    ),
    retry,
  };
}

type Topic = {
  key: string;
  title: string;
  description: string;
  entry: WikiManifestPage;
  pages: WikiManifestPage[];
};
function educationTopics(pages: WikiManifestPage[]): Topic[] {
  const grouped = new Map<string, WikiManifestPage[]>();
  for (const page of pages) {
    const relative = page.slug.slice(EDUCATION_PREFIX.length);
    const key = relative.includes("/") ? relative.split("/")[0]! : "overview";
    const group = grouped.get(key) ?? [];
    group.push(page);
    grouped.set(key, group);
  }
  return [...grouped]
    .map(([key, pages]) => {
      pages.sort((a, b) =>
        a.slug.endsWith("/index") !== b.slug.endsWith("/index")
          ? a.slug.endsWith("/index")
            ? -1
            : 1
          : a.title.localeCompare(b.title),
      );
      const entry =
        pages.find((page) => page.slug === `${EDUCATION_PREFIX}${key}/index`) ??
        pages[0]!;
      return {
        key,
        title:
          key === "overview"
            ? "Getting started"
            : markdownTitleToText(entry.title),
        description:
          entry.description ??
          "Explore the lessons, visual explanations, and resources in this topic.",
        entry,
        pages,
      };
    })
    .sort((a, b) =>
      a.key === "overview"
        ? -1
        : b.key === "overview"
          ? 1
          : a.title.localeCompare(b.title),
    );
}

function EducationLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return href?.startsWith("/education") ? (
    <Link to={href} {...props}>
      {children}
    </Link>
  ) : (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

function Feedback({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: string;
  retry: () => void;
}) {
  if (error)
    return (
      <div className="edu-feedback" role="alert">
        <p>{error}</p>
        <button onClick={retry}>Try again</button>
      </div>
    );
  return loading ? (
    <p className="edu-feedback" role="status">
      Loading education…
    </p>
  ) : null;
}

function EducationArticle({
  slug,
  pages,
}: {
  slug: string;
  pages: WikiManifestPage[];
}) {
  const resource = useEducationResource<WikiPageBatch>(
    `/api/education/pages?slugs=${encodeURIComponent(slug)}`,
  );
  const page = resource.data?.pages.find(
    (page) => isEducationSlug(page.slug) && page.sensitive === false,
  );
  const metadata = pages.find((entry) => entry.slug === slug);
  const navigate = useNavigate();
  const { hash } = useLocation();
  const routeAdapter = useMemo(
    () => ({
      push: (href: string) => navigate(educationLinkHref(href, slug) ?? href),
    }),
    [navigate, slug],
  );
  const resolveLink = useCallback(
    (href: string | undefined) => educationLinkHref(href, slug),
    [slug],
  );
  useEffect(() => {
    if (hash && page)
      requestAnimationFrame(() => {
        try {
          document
            .getElementById(decodeURIComponent(hash.slice(1)))
            ?.scrollIntoView();
        } catch {
          /* Invalid fragments do not interrupt reading. */
        }
      });
  }, [hash, page]);
  return (
    <article className="edu-article" data-test-id="education-article">
      <nav className="edu-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/education">Education</Link>
        <span aria-hidden="true">/</span>
        <span>
          {markdownTitleToText(page?.title ?? metadata?.title ?? "Lesson")}
        </span>
      </nav>
      <Feedback {...resource} />
      {page ? (
        <>
          <div className="edu-eyebrow">THE EDUCATION LIBRARY</div>
          <h1>
            <MarkdownTitle title={page.title} currentSlug={page.slug} />
          </h1>
          {metadata?.description ? (
            <p className="edu-article-description">{metadata.description}</p>
          ) : null}
          <div className="edu-article-rule" />
          <WikiMarkdown
            content={page.content}
            currentSlug={page.slug}
            apiBasePath="/api/education"
            LinkComponent={EducationLink}
            resolveLinkHref={resolveLink}
            routeAdapter={routeAdapter}
            loadingFallback={<p role="status">Loading lesson…</p>}
          />
          {/^\s*```mermaid\s*$/m.test(page.content) ? (
            <Suspense fallback={null}>
              <MermaidRenderer />
            </Suspense>
          ) : null}
          <div className="edu-article-footer">
            <Link to="/education">
              <BookOpen size={16} /> Browse all topics
            </Link>
            <a
              href={`/api/education/page-copy?slug=${encodeURIComponent(page.slug)}`}
            >
              Download Markdown
            </a>
          </div>
        </>
      ) : !resource.loading && !resource.error ? (
        <div className="edu-feedback">
          <h1>Lesson not found</h1>
          <p>This page is not in the public education library.</p>
          <Link to="/education">Browse the library</Link>
        </div>
      ) : null}
    </article>
  );
}

function EducationSearch({
  query,
  pages,
}: {
  query: string;
  pages: WikiManifestPage[];
}) {
  const resource = useEducationResource<SearchResponse>(
    query.length >= 2
      ? `/api/education/search?q=${encodeURIComponent(query)}&limit=100`
      : null,
  );
  const titles = pages.filter((page) =>
    `${page.title} ${page.description ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const results = new Map<string, SearchResult>();
  if (query.length >= 2)
    for (const page of titles)
      results.set(page.slug, {
        ...page,
        excerpt: page.description ?? undefined,
      });
  for (const result of resource.data?.results ?? [])
    if (isEducationSlug(result.slug)) results.set(result.slug, result);
  return (
    <section className="edu-search-results">
      <div className="edu-eyebrow">SEARCH THE LIBRARY</div>
      <h1>{query ? <>Results for “{query}”</> : "Find something to learn"}</h1>
      {query.length < 2 ? (
        <p className="edu-lead">
          Enter at least two characters to search the education library.
        </p>
      ) : (
        <>
          <p className="edu-lead">
            {results.size} {results.size === 1 ? "page" : "pages"} in education
            {resource.partial ? " · Searching lesson text…" : ""}
          </p>
          <Feedback {...resource} />
          <div className="edu-result-list">
            {[...results.values()].map((result) => (
              <Link
                className="edu-result"
                key={result.slug}
                to={educationHref(result.slug)}
              >
                <span className="edu-result-path">
                  {result.slug
                    .slice(EDUCATION_PREFIX.length)
                    .split("/")
                    .slice(0, -1)
                    .join(" / ") || "Getting started"}
                </span>
                <h2>{markdownTitleToText(result.title)}</h2>
                <p>
                  {(
                    result.excerpt ||
                    result.matches?.[0]?.lineContent ||
                    "Read this lesson in the education library."
                  ).slice(0, 260)}
                </p>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
          {!resource.loading &&
          !resource.error &&
          !resource.partial &&
          !results.size ? (
            <p className="edu-feedback">
              No pages found. Try a broader term or browse the topics.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function EducationApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const manifest = useEducationResource<WikiManifest>(
    "/api/education/manifest",
  );
  const pages = useMemo(
    () =>
      manifest.data?.pages.filter(
        (page) => isEducationSlug(page.slug) && page.sensitive === false,
      ) ?? EMPTY_PAGES,
    [manifest.data],
  );
  const topics = useMemo(() => educationTopics(pages), [pages]);
  const routeSlug = educationSlugFromPathname(location.pathname);
  const canonicalSlugs = useMemo(() => {
    const map = new Map(
      canonicalSlugLookupEntriesFromSlugs(pages.map((page) => page.slug)),
    );
    for (const page of pages)
      if (
        page.slug.endsWith("/index") &&
        !map.has(page.slug.slice(0, -6).toLowerCase())
      ) {
        map.set(page.slug.slice(0, -6).toLowerCase(), page.slug);
      }
    return map;
  }, [pages]);
  const slug = routeSlug
    ? (canonicalSlugs.get(routeSlug.toLowerCase()) ?? routeSlug)
    : null;
  const query = new URLSearchParams(location.search).get("q") ?? "";
  const isSearch = location.pathname === "/education/search";
  const [menuOpen, setMenuOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const start =
    pages.find(
      (page) => page.slug === `${EDUCATION_PREFIX}oncology-101/index`,
    ) ?? topics[0]?.entry;
  const title = slug
    ? (pages.find((page) => page.slug === slug)?.title ?? "Education")
    : isSearch
      ? "Search education"
      : "Cancer science, made approachable";
  useEffect(() => {
    if (slug && routeSlug && slug !== routeSlug)
      navigate(`${educationHref(slug)}${location.search}${location.hash}`, {
        replace: true,
      });
  }, [slug, routeSlug, navigate, location.search, location.hash]);
  useEffect(() => {
    const description =
      "Explore the Oncobase education library: cancer biology, immunotherapy, and the science behind treatment.";
    updateClientRouteMetadata({
      title: `${markdownTitleToText(title)} — Oncobase Education`,
      description,
      openGraphTitle: markdownTitleToText(title),
      openGraphDescription: description,
      openGraphType: slug ? "article" : "website",
      twitterTitle: markdownTitleToText(title),
      twitterDescription: description,
    });
  }, [title, slug]);
  useEffect(() => {
    if (!location.hash) main.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname, location.search, location.hash]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const closeMenu = () => setMenuOpen(false);
  return (
    <div className="education-app" data-test-id="education-app">
      <a className="edu-skip" href="#education-main">
        Skip to content
      </a>
      <header className="edu-header">
        <Link to="/education" className="edu-brand" onClick={closeMenu}>
          <span className="edu-brand-icon">
            <Network size={22} />
          </span>
          <span>
            oncobase <span className="edu-brand-section">education</span>
          </span>
        </Link>
        <form
          className="edu-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const value = searchInput.current?.value.trim() ?? "";
            navigate(
              `/education/search${value ? `?q=${encodeURIComponent(value)}` : ""}`,
            );
            closeMenu();
          }}
        >
          <Search size={17} aria-hidden="true" />
          <input
            key={query}
            ref={searchInput}
            defaultValue={query}
            type="search"
            aria-label="Search education"
            placeholder="Search education…"
          />
          <button type="submit" aria-label="Submit education search">
            <ArrowRight size={17} />
          </button>
        </form>
        <PublicThemeControl />
        <a className="edu-wiki-link" href="/">
          Care wiki <ArrowRight size={14} />
        </a>
        <button
          className="edu-menu-toggle"
          aria-label={
            menuOpen
              ? "Close education navigation"
              : "Open education navigation"
          }
          aria-expanded={menuOpen}
          aria-controls="education-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      <div className="edu-layout">
        <aside
          className={`edu-sidebar${menuOpen ? " edu-sidebar-open" : ""}`}
          id="education-navigation"
        >
          <nav aria-label="Education navigation">
            <Link
              to="/education"
              className="edu-all-topics"
              aria-current={!slug && !isSearch ? "page" : undefined}
              onClick={closeMenu}
            >
              <BookOpen size={17} /> All topics
            </Link>
            <div className="edu-sidebar-label">EXPLORE THE CURRICULUM</div>
            <Feedback {...manifest} />
            {topics.map((topic) => (
              <details
                key={`${topic.key}:${slug?.split("/")[2] === topic.key}`}
                open={
                  slug?.split("/")[2] === topic.key ||
                  topic.key === "overview" ||
                  undefined
                }
              >
                <summary>
                  <span>{topic.title}</span>
                  <ChevronDown size={14} />
                </summary>
                <div className="edu-nav-lessons">
                  {topic.pages.map((page) => (
                    <Link
                      key={page.slug}
                      to={educationHref(page.slug)}
                      aria-current={slug === page.slug ? "page" : undefined}
                      onClick={closeMenu}
                    >
                      {markdownTitleToText(page.title)}
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </nav>
          <div className="edu-sidebar-footer">
            Open knowledge.
            <br />
            Learn at your own pace.
          </div>
        </aside>
        <main className="edu-main" id="education-main" ref={main} tabIndex={-1}>
          {isSearch ? (
            <EducationSearch key={query} query={query} pages={pages} />
          ) : slug ? (
            <EducationArticle key={slug} slug={slug} pages={pages} />
          ) : (
            <>
              <section className="edu-hero">
                <div className="edu-eyebrow">
                  <span /> OPEN TO EVERYONE
                </div>
                <h1>
                  Cancer science,
                  <br />
                  <em>made approachable.</em>
                </h1>
                <p className="edu-lead">
                  A place to understand the biology, explore the treatments, and
                  connect the ideas. Start with the foundations or follow your
                  curiosity.
                </p>
                <div className="edu-hero-actions">
                  {start ? (
                    <Link className="edu-start" to={educationHref(start.slug)}>
                      Start learning <ArrowRight size={17} />
                    </Link>
                  ) : null}
                  <a href="#education-topics" className="edu-browse">
                    Explore the library <ChevronDown size={16} />
                  </a>
                </div>
                <div className="edu-hero-art" aria-hidden="true">
                  <div className="edu-art-orbit edu-art-orbit-one" />
                  <div className="edu-art-orbit edu-art-orbit-two" />
                  <div className="edu-art-center">
                    <Dna size={66} strokeWidth={1} />
                  </div>
                  <span className="edu-art-node edu-art-node-one">
                    <BookOpen size={23} strokeWidth={1.5} />
                  </span>
                  <span className="edu-art-node edu-art-node-two">
                    <Network size={24} strokeWidth={1.5} />
                  </span>
                  <span className="edu-art-dot" />
                </div>
              </section>
              <section id="education-topics" className="edu-library">
                <div className="edu-library-heading">
                  <div>
                    <div className="edu-eyebrow">FOLLOW YOUR CURIOSITY</div>
                    <h2>The education library</h2>
                  </div>
                  {pages.length ? (
                    <span>
                      {topics.length} topics · {pages.length} pages
                    </span>
                  ) : null}
                </div>
                <Feedback {...manifest} />
                {manifest.partial ? (
                  <p className="edu-feedback" role="status">
                    Updating the library…{" "}
                    <button onClick={manifest.retry}>Refresh</button>
                  </p>
                ) : null}
                <div className="edu-topic-grid">
                  {topics.map((topic, index) => (
                    <Link
                      className="edu-topic-card"
                      key={topic.key}
                      to={educationHref(topic.entry.slug)}
                    >
                      <div className="edu-topic-top">
                        <span className="edu-topic-icon">
                          {index % 3 === 0 ? (
                            <BookOpen size={23} strokeWidth={1.5} />
                          ) : index % 3 === 1 ? (
                            <Dna size={23} strokeWidth={1.5} />
                          ) : (
                            <Network size={23} strokeWidth={1.5} />
                          )}
                        </span>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <h3>{topic.title}</h3>
                      <p>{topic.description}</p>
                      <div className="edu-topic-bottom">
                        <span>
                          {topic.pages.length}{" "}
                          {topic.pages.length === 1 ? "page" : "pages"}
                        </span>
                        <ArrowRight size={19} />
                      </div>
                    </Link>
                  ))}
                </div>
                {!manifest.loading && !manifest.error && !pages.length ? (
                  <p className="edu-feedback">
                    The education library has no published pages yet.
                  </p>
                ) : null}
              </section>
              <footer className="edu-home-footer">
                <BookOpen size={18} />
                <p>
                  Curriculum, visual explanations, and resources. All freely
                  accessible.
                </p>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
