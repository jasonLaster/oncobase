import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import ReactMarkdown from "react-markdown";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  protectCurrencyFromMath,
} from "@oncobase/wiki-markdown";
import { recordSearchMetric } from "../observability";
import { isWithinTextSearchLatencyBudget } from "../search-performance";
import { useWikiScope } from "../wiki-context";
import { hrefForSlug } from "../wiki-utils";
import {
  updateClientRouteMetadata,
  WIKI_SITE_DESCRIPTION,
  WIKI_SITE_NAME,
} from "../document-title";

type TextSearchMatch = {
  lineContent: string;
  lineNumber: number;
  matchEnd?: number;
  matchStart?: number;
};

type TextSearchResult = {
  slug: string;
  title: string;
  tags?: string[];
  excerpt?: string;
  matches?: TextSearchMatch[];
  sensitive?: boolean;
};

type AISearchResult = {
  slug: string;
  title: string;
  tags?: string[];
  relevance?: number;
  summary?: string;
};

type SearchMode = "text" | "ai";
type SearchStatus = "idle" | "loading" | "ready" | "error";

type TextSearchTreeResult = TextSearchResult & {
  matches: TextSearchMatch[];
  resultIndex: number;
};

type SearchDirectory = {
  dirs: Map<string, SearchDirectory>;
  files: TextSearchTreeResult[];
  name: string;
  path: string;
  totalMatches: number;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightQuery(value: string, query: string) {
  const normalized = query.trim();
  if (!normalized) return value;
  return value.replace(new RegExp(`(${escapeRegex(normalized)})`, "gi"), "<mark>$1</mark>");
}

function normalizeTextResults(results: TextSearchResult[]): TextSearchTreeResult[] {
  const normalized: TextSearchTreeResult[] = [];
  for (const [resultIndex, result] of results.entries()) {
    const next = {
      ...result,
      matches: result.matches?.length
        ? result.matches
        : result.excerpt
          ? [{ lineContent: result.excerpt, lineNumber: 1 }]
          : [],
      resultIndex,
    };
    if (next.matches.length > 0) normalized.push(next);
  }
  return normalized;
}

function buildSearchTree(results: TextSearchTreeResult[]) {
  const root: SearchDirectory = {
    dirs: new Map(),
    files: [],
    name: "",
    path: "",
    totalMatches: 0,
  };

  for (const result of results) {
    const parts = result.slug.split("/");
    const fileName = parts.pop() ?? result.slug;
    let node = root;

    for (const part of parts) {
      if (!node.dirs.has(part)) {
        const childPath = node.path ? `${node.path}/${part}` : part;
        node.dirs.set(part, {
          dirs: new Map(),
          files: [],
          name: part,
          path: childPath,
          totalMatches: 0,
        });
      }
      node = node.dirs.get(part)!;
    }

    node.files.push({ ...result, title: fileName });
  }

  function countMatches(node: SearchDirectory): number {
    let total = node.files.reduce((sum, result) => sum + result.matches.length, 0);
    for (const child of node.dirs.values()) total += countMatches(child);
    node.totalMatches = total;
    return total;
  }

  countMatches(root);
  return root;
}

function searchPath(query: string, returnTo: string | null) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (returnTo) params.set("returnTo", returnTo);
  const search = params.toString();
  return `/search${search ? `?${search}` : ""}`;
}

async function readJsonBody<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      response.ok
        ? "Search returned an invalid response."
        : `Search failed with ${response.status} ${response.statusText}.`,
    );
  }
}

type TextSearchResponse = {
  body: { results?: TextSearchResult[]; error?: string };
  durationMs: number;
  ok: boolean;
  status: number;
  statusText: string;
};

const pendingTextSearchRequests = new Map<string, Promise<TextSearchResponse>>();

function requestTextSearch(searchParams: URLSearchParams) {
  const key = searchParams.toString();
  const existing = pendingTextSearchRequests.get(key);
  if (existing) return existing;

  const query = searchParams.get("q") ?? "";
  const startedAt = performance.now();
  const pending = fetch(`/api/search?${searchParams}`).then(async (response) => ({
    body: await readJsonBody<{ results?: TextSearchResult[]; error?: string }>(response),
    durationMs: performance.now() - startedAt,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  }));
  pendingTextSearchRequests.set(key, pending);
  const clearPending = () => {
    if (pendingTextSearchRequests.get(key) === pending) {
      pendingTextSearchRequests.delete(key);
    }
  };
  void pending.then(
    (response) => {
      clearPending();
      const ready = response.ok && !response.body.error;
      const results = Array.isArray(response.body.results) ? response.body.results : [];
      recordSearchMetric({
        query,
        mode: "text",
        durationMs: response.durationMs,
        withinBudget: isWithinTextSearchLatencyBudget(response.durationMs),
        resultCount: ready ? results.length : 0,
        status: ready ? "ready" : "error",
      });
    },
    () => {
      clearPending();
      const durationMs = performance.now() - startedAt;
      recordSearchMetric({
        query,
        mode: "text",
        durationMs,
        withinBudget: isWithinTextSearchLatencyBudget(durationMs),
        resultCount: 0,
        status: "error",
      });
    },
  );
  return pending;
}

function SearchInput({
  onSubmit,
  query,
}: {
  onSubmit: (query: string) => void;
  query: string;
}) {
  const [draft, setDraft] = useState(query);

  return (
    <form
      className="relative mb-6 px-2"
      data-test-id="search-form"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = draft.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
      }}
      role="search"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 opacity-40"
        fill="currentColor"
        height="16"
        viewBox="0 0 16 16"
        width="16"
      >
        <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
      </svg>
      <input
        aria-label="Search the wiki"
        autoFocus={!query}
        className="w-full rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] py-2 pl-10 pr-3 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
        data-test-id="search-form-input"
        name="q"
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder="Search the wiki…"
        type="text"
        value={draft}
      />
    </form>
  );
}

function SearchModeToggle({
  mode,
  onModeChange,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-1 px-2">
      <div className="inline-flex rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-0.5">
        <button
          aria-pressed={mode === "ai"}
          className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors ${
            mode === "ai"
              ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
          }`}
          data-test-id="search-tab-ai"
          onClick={() => onModeChange("ai")}
          type="button"
        >
          <svg
            fill="none"
            height="12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            viewBox="0 0 16 16"
            width="12"
          >
            <path d="M8 2l1.5 4.5H14l-3.5 2.5L12 14 8 11l-4 3 1.5-5L2 6.5h4.5z" />
          </svg>
          AI Mode
        </button>
        <button
          aria-pressed={mode === "text"}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            mode === "text"
              ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
          }`}
          data-test-id="search-tab-text"
          onClick={() => onModeChange("text")}
          type="button"
        >
          Text Search
        </button>
      </div>
    </div>
  );
}

function EmptySearch() {
  return (
    <div
      className="py-8 text-center text-sm text-[var(--text-muted)]"
      data-test-id="search-empty"
    >
      Type a query to search across all wiki pages
    </div>
  );
}

function FileMatches({
  active,
  collapsed,
  onFocus,
  onToggle,
  query,
  result,
}: {
  active: boolean;
  collapsed: boolean;
  onFocus: () => void;
  onToggle: () => void;
  query: string;
  result: TextSearchTreeResult;
}) {
  return (
    <div
      className={`search-page-result mb-0.5 rounded ${
        active ? "active bg-[var(--accent-light)]" : ""
      }`}
      data-slug={result.slug}
    >
      <button
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--sidebar-bg)]"
        data-test-id="search-text-file"
        onClick={onToggle}
        type="button"
      >
        <span className="w-4 text-center text-xs opacity-50">{collapsed ? "▶" : "▼"}</span>
        <svg
          aria-hidden="true"
          className="shrink-0 opacity-50"
          fill="currentColor"
          height="14"
          viewBox="0 0 16 16"
          width="14"
        >
          <path d="M13 4H8.4l-.6-.6-.3-.4H3l-.5.5v9l.5.5h10l.5-.5V4.5L13 4zm-.5 8h-9V4.5h3.6l.8.8.2.2H12.5v6.5z" />
        </svg>
        <span className="text-sm text-[var(--foreground)]">{result.title}</span>
        <span className="ml-auto rounded-full bg-[var(--sidebar-bg)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
          {result.matches.length}
        </span>
      </button>
      {!collapsed ? (
        <div className="ml-6 border-l border-[var(--sidebar-border)]">
          {result.matches.map((match, index) => (
            <Link
              className="flex items-start gap-3 px-3 py-0.5 text-sm transition-colors hover:bg-[var(--sidebar-bg)]"
              data-test-id="search-text-result"
              key={`${result.slug}-${match.lineNumber}-${index}`}
              onFocus={onFocus}
              to={hrefForSlug(result.slug)}
            >
              <span className="w-8 shrink-0 select-none pt-1 text-right font-mono text-xs text-[var(--text-muted)]">
                {match.lineNumber}
              </span>
              <div className="max-w-none break-words leading-relaxed text-[var(--foreground)] opacity-80 [&>*]:m-0 [&_a]:text-[var(--brand)] [&_a]:no-underline [&_code]:rounded [&_code]:bg-[var(--sidebar-bg)] [&_code]:px-1 [&_code]:text-xs [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_h4]:text-sm [&_h4]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_mark]:rounded-sm [&_mark]:bg-[var(--brand)]/15 [&_mark]:px-0.5 [&_mark]:text-[var(--brand)] [&_strong]:font-semibold [&_table]:border-collapse [&_table]:text-xs [&_td]:border-b [&_td]:border-[var(--sidebar-border)] [&_td]:py-0.5 [&_td]:pr-3 [&_th]:border-b [&_th]:border-[var(--sidebar-border)] [&_th]:pr-3 [&_th]:text-left [&_th]:font-semibold">
                <ReactMarkdown
                  components={{ a: ({ children }) => <span>{children}</span> }}
                  rehypePlugins={markdownRehypePlugins}
                  remarkPlugins={markdownRemarkPlugins}
                >
                  {protectCurrencyFromMath(
                    highlightQuery(match.lineContent, query),
                  )}
                </ReactMarkdown>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DirectoryTree({
  activeIndex,
  collapsedDirectories,
  collapsedFiles,
  depth,
  node,
  onFocusResult,
  onToggleDirectory,
  onToggleFile,
  query,
}: {
  activeIndex: number;
  collapsedDirectories: Set<string>;
  collapsedFiles: Set<string>;
  depth: number;
  node: SearchDirectory;
  onFocusResult: (index: number) => void;
  onToggleDirectory: (path: string) => void;
  onToggleFile: (slug: string) => void;
  query: string;
}) {
  const collapsed = collapsedDirectories.has(node.path);
  const directories = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => b.matches.length - a.matches.length);

  return (
    <div style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
      {depth > 0 ? (
        <button
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-bg)]"
          data-path={node.path}
          data-test-id="search-text-directory"
          onClick={() => onToggleDirectory(node.path)}
          type="button"
        >
          <span className="w-4 text-center text-xs opacity-50">{collapsed ? "▶" : "▼"}</span>
          <svg
            aria-hidden="true"
            className="shrink-0 opacity-70"
            fill="currentColor"
            height="14"
            viewBox="0 0 16 16"
            width="14"
          >
            <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
          </svg>
          <span className="text-sm font-medium text-[var(--foreground)]">{node.name}</span>
          <span className="ml-auto rounded-full bg-[var(--sidebar-bg)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
            {node.totalMatches}
          </span>
        </button>
      ) : null}
      {!collapsed ? (
        <div>
          {directories.map((directory) => (
            <DirectoryTree
              activeIndex={activeIndex}
              collapsedDirectories={collapsedDirectories}
              collapsedFiles={collapsedFiles}
              depth={depth + 1}
              key={directory.path}
              node={directory}
              onFocusResult={onFocusResult}
              onToggleDirectory={onToggleDirectory}
              onToggleFile={onToggleFile}
              query={query}
            />
          ))}
          {files.map((result) => (
            <div key={result.slug} style={{ paddingLeft: 8 }}>
              <FileMatches
                active={result.resultIndex === activeIndex}
                collapsed={collapsedFiles.has(result.slug)}
                onFocus={() => onFocusResult(result.resultIndex)}
                onToggle={() => onToggleFile(result.slug)}
                query={query}
                result={result}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TextSearch({
  activeIndex,
  error,
  onFocusResult,
  query,
  results,
  status,
}: {
  activeIndex: number;
  error: string | null;
  onFocusResult: (index: number) => void;
  query: string;
  results: TextSearchResult[];
  status: SearchStatus;
}) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const normalizedResults = useMemo(() => normalizeTextResults(results), [results]);
  const tree = useMemo(() => buildSearchTree(normalizedResults), [normalizedResults]);

  if (!query) return <EmptySearch />;

  if (status === "loading") {
    return (
      <div
        aria-label="Searching text"
        className="py-4 text-sm text-[var(--text-muted)]"
        data-test-id="search-text-loading"
        role="status"
      >
        Searching...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-2 py-4 text-sm text-red-500" data-test-id="search-text-error">
        Search failed: {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div
        className="py-4 text-sm text-[var(--text-muted)]"
        data-test-id="search-text-empty"
      >
        No results for &quot;{query}&quot;
      </div>
    );
  }

  const totalMatches = normalizedResults.reduce(
    (sum, result) => sum + result.matches.length,
    0,
  );

  function toggleDirectory(path: string) {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleFile(slug: string) {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <div>
      <div
        className="mb-3 px-2 text-xs text-[var(--text-muted)]"
        data-test-id="search-text-summary"
      >
        {totalMatches} result{totalMatches !== 1 ? "s" : ""} in{" "}
        {normalizedResults.length} file{normalizedResults.length !== 1 ? "s" : ""}
      </div>
      <DirectoryTree
        activeIndex={activeIndex}
        collapsedDirectories={collapsedDirectories}
        collapsedFiles={collapsedFiles}
        depth={0}
        node={tree}
        onFocusResult={onFocusResult}
        onToggleDirectory={toggleDirectory}
        onToggleFile={toggleFile}
        query={query}
      />
    </div>
  );
}

function AISearch({
  activeIndex,
  error,
  onFocusResult,
  query,
  results,
  status,
}: {
  activeIndex: number;
  error: string | null;
  onFocusResult: (index: number) => void;
  query: string;
  results: AISearchResult[];
  status: SearchStatus;
}) {
  if (!query) return <EmptySearch />;

  if (status === "loading") {
    return (
      <div
        aria-label="Analyzing results with AI"
        className="flex items-center gap-2 px-2 py-4 text-sm text-[var(--text-muted)]"
        data-test-id="search-ai-loading"
        role="status"
      >
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            fill="currentColor"
          />
        </svg>
        Analyzing results with AI...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-2 py-4 text-sm text-red-500" data-test-id="search-ai-error">
        Search failed: {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div
        className="px-2 py-4 text-sm text-[var(--text-muted)]"
        data-test-id="search-ai-empty"
      >
        No relevant results for &quot;{query}&quot;
      </div>
    );
  }

  return (
    <div className="space-y-2 px-2">
      <div
        className="mb-3 text-xs text-[var(--text-muted)]"
        data-test-id="search-ai-summary"
      >
        {results.length} result{results.length !== 1 ? "s" : ""} ranked by relevance
      </div>
      {results.map((result, index) => (
        <Link
          className={`search-page-result block rounded-lg border border-[var(--sidebar-border)] p-3 no-underline transition-colors hover:border-[var(--brand)] hover:bg-[var(--accent-light)] ${
            index === activeIndex ? "active border-[var(--brand)] bg-[var(--accent-light)]" : ""
          }`}
          data-test-id="search-ai-result"
          id={`search-result-${index}`}
          key={result.slug}
          onFocus={() => onFocusResult(index)}
          to={hrefForSlug(result.slug)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-[var(--foreground)]">
                {result.title}
              </h3>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{result.slug}</p>
            </div>
            {typeof result.relevance === "number" ? (
              <span className="shrink-0 rounded-full bg-[var(--brand)]/10 px-1.5 py-0.5 text-xs font-medium text-[var(--brand)]">
                {result.relevance}/10
              </span>
            ) : null}
          </div>
          {result.summary ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--foreground)]/80">
              {result.summary}
            </p>
          ) : null}
          {result.tags && result.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {result.tags.slice(0, 5).map((tag) => (
                <span
                  className="rounded-full bg-[var(--sidebar-bg)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                  key={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const scope = useWikiScope();
  const query = params.get("q") ?? "";
  const returnTo = params.get("returnTo");
  const explicitModeParam = params.get("tab") ?? params.get("mode");
  const initialMode: SearchMode = explicitModeParam === "text" ? "text" : "ai";
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [textResults, setTextResults] = useState<TextSearchResult[]>([]);
  const [textResultsQuery, setTextResultsQuery] = useState("");
  const [textStatus, setTextStatus] = useState<SearchStatus>(query ? "loading" : "idle");
  const [textError, setTextError] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<AISearchResult[]>([]);
  const [aiStatus, setAiStatus] = useState<SearchStatus>(query ? "loading" : "idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const description = "Search across all wiki pages";
    updateClientRouteMetadata({
      description,
      openGraphDescription: description,
      openGraphTitle: "Search",
      title: `Search — ${WIKI_SITE_NAME}`,
      twitterDescription: WIKI_SITE_DESCRIPTION,
      twitterTitle: WIKI_SITE_NAME,
    });
  }, []);

  useEffect(() => {
    if (explicitModeParam === "text") setMode("text");
    if (explicitModeParam === "ai") setMode("ai");
  }, [explicitModeParam]);

  const slugs = useMemo(() => {
    if (textResultsQuery !== query) return [];
    const seen = new Set<string>();
    return textResults
      .filter((result) => {
        if (seen.has(result.slug)) return false;
        seen.add(result.slug);
        return true;
      })
      .slice(0, 12)
      .map((result) => result.slug);
  }, [query, textResults, textResultsQuery]);

  const runTextSearch = useCallback(async (nextQuery: string) => {
    const normalized = nextQuery.trim();
    setTextResultsQuery(normalized);
    setActiveIndex(0);

    if (normalized.length < 2) {
      setTextResults([]);
      setTextStatus(normalized ? "ready" : "idle");
      setTextError(null);
      return;
    }

    setTextStatus("loading");
    setTextError(null);

    try {
      const searchParams = new URLSearchParams({ q: normalized, scope });
      const response = await requestTextSearch(searchParams);
      const { body } = response;
      if (body.error) throw new Error(body.error);
      if (!response.ok) {
        throw new Error(`Search failed with ${response.status} ${response.statusText}.`);
      }

      const results = Array.isArray(body.results) ? body.results : [];
      setTextResults(results);
      setTextStatus("ready");
    } catch (error) {
      setTextResults([]);
      setTextStatus("error");
      setTextError(error instanceof Error ? error.message : "Search failed.");
    }
  }, [scope]);

  useEffect(() => {
    void runTextSearch(query);
  }, [query, runTextSearch]);

  useEffect(() => {
    const normalized = query.trim();
    const startedAt = performance.now();
    setAiResults([]);
    setAiError(null);

    if (normalized.length < 2) {
      setAiStatus(normalized ? "ready" : "idle");
      return;
    }

    let cancelled = false;
    setAiStatus("loading");

    fetch(`/api/ai-search?scope=${encodeURIComponent(scope)}`, {
      body: JSON.stringify({ query: normalized, slugs }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async (response) => {
        const body = await readJsonBody<{ results?: AISearchResult[]; error?: string }>(response);
        if (body.error) throw new Error(body.error);
        if (!response.ok) {
          throw new Error(`Search failed with ${response.status} ${response.statusText}.`);
        }
        return Array.isArray(body.results) ? body.results : [];
      })
      .then((results) => {
        if (cancelled) return;
        setAiResults(results);
        setAiStatus("ready");
        recordSearchMetric({
          query: normalized,
          mode: "ai",
          durationMs: performance.now() - startedAt,
          resultCount: results.length,
          status: "ready",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setAiResults([]);
        setAiStatus("error");
        setAiError(error instanceof Error ? error.message : "AI search failed.");
        recordSearchMetric({
          query: normalized,
          mode: "ai",
          durationMs: performance.now() - startedAt,
          resultCount: 0,
          status: "error",
        });
      });

    return () => {
      cancelled = true;
    };
    // Slugs come from the slower text-search path. AI mode should begin
    // immediately and not refetch when those candidates arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope]);

  function onResultsKeyDown(event: KeyboardEvent<HTMLElement>) {
    const activeResults = mode === "ai" ? aiResults : textResults;
    if (activeResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(activeResults.length - 1, index + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      navigate(hrefForSlug(activeResults[activeIndex]?.slug ?? activeResults[0].slug));
    }
  }

  return (
    <div
      className="h-full overflow-y-auto"
      data-search-query={query}
      data-test-id="search-page"
    >
      <div className="px-2 py-4 md:px-4 md:py-6">
        <SearchInput
          key={query}
          onSubmit={(nextQuery) => navigate(searchPath(nextQuery, returnTo))}
          query={query}
        />
        {query ? (
          <SearchModeToggle
            mode={mode}
            onModeChange={(nextMode) => {
              setMode(nextMode);
              setActiveIndex(0);
            }}
          />
        ) : null}
        <section
          aria-label="Search results"
          data-test-id="search-results"
          onKeyDown={onResultsKeyDown}
          tabIndex={(mode === "ai" ? aiResults : textResults).length > 0 ? 0 : -1}
        >
          {mode === "ai" ? (
            <AISearch
              activeIndex={activeIndex}
              error={aiError}
              onFocusResult={setActiveIndex}
              query={query}
              results={aiResults}
              status={aiStatus}
            />
          ) : (
            <TextSearch
              activeIndex={activeIndex}
              error={textError}
              key={query}
              onFocusResult={setActiveIndex}
              query={query}
              results={textResults}
              status={textStatus}
            />
          )}
        </section>
      </div>
    </div>
  );
}
