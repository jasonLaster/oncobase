import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MarkdownTitle, type MarkdownTitleLinkProps } from "@oncobase/wiki-markdown";
import { recordSearchMetric } from "../observability";
import { hrefForSlug } from "../wiki-utils";

type TextSearchMatch = {
  lineContent: string;
  lineNumber: number;
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

function SearchSnippetLink({ href, children, ...props }: MarkdownTitleLinkProps) {
  return (
    <Link to={href} {...props}>
      {children}
    </Link>
  );
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

function SearchInput({
  onSubmit,
  query,
}: {
  onSubmit: (query: string) => void;
  query: string;
}) {
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

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
        placeholder="Search the wiki..."
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

function TextSnippet({ result }: { result: TextSearchResult }) {
  const snippets = result.matches?.length
    ? result.matches.map((match) => match.lineContent)
    : result.excerpt
      ? [result.excerpt]
      : [];

  if (snippets.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 text-xs text-[var(--foreground)]/80">
      {snippets.slice(0, 3).map((snippet, index) => (
        <div
          className="break-words leading-relaxed [&_a]:text-[var(--brand)] [&_a]:no-underline [&_code]:rounded [&_code]:bg-[var(--sidebar-bg)] [&_code]:px-1 [&_code]:text-xs [&_strong]:font-semibold"
          key={`${result.slug}-snippet-${index}`}
        >
          <MarkdownTitle
            LinkComponent={SearchSnippetLink}
            currentSlug={result.slug}
            title={snippet}
          />
        </div>
      ))}
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

  const totalMatches = results.reduce(
    (sum, result) => sum + (result.matches?.length ?? 1),
    0,
  );
  const hasLineMatches = results.some((result) => result.matches?.length);

  return (
    <div className="space-y-2 px-2">
      <div
        className="mb-3 text-xs text-[var(--text-muted)]"
        data-test-id="search-text-summary"
      >
        {hasLineMatches
          ? `${totalMatches} result${totalMatches !== 1 ? "s" : ""} in ${results.length} file${
              results.length !== 1 ? "s" : ""
            }`
          : `${results.length} result${results.length !== 1 ? "s" : ""}`}
      </div>
      {results.map((result, index) => (
        <article
          className={`search-page-result rounded-lg border border-[var(--sidebar-border)] p-3 transition-colors hover:border-[var(--brand)] hover:bg-[var(--accent-light)] ${
            index === activeIndex ? "active border-[var(--brand)] bg-[var(--accent-light)]" : ""
          }`}
          data-test-id="search-text-result"
          id={`search-result-${index}`}
          key={result.slug}
          onFocus={() => onFocusResult(index)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                className="block truncate text-sm font-medium text-[var(--foreground)] no-underline"
                to={hrefForSlug(result.slug)}
              >
                {result.title}
              </Link>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{result.slug}</p>
            </div>
            {result.sensitive ? (
              <span className="shrink-0 rounded-full bg-[var(--sidebar-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                sensitive
              </span>
            ) : null}
          </div>
          <TextSnippet result={result} />
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
        </article>
      ))}
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
    const startedAt = performance.now();
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
      const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}&limit=20`);
      const body = await readJsonBody<{ results?: TextSearchResult[]; error?: string }>(response);
      if (body.error) throw new Error(body.error);
      if (!response.ok) {
        throw new Error(`Search failed with ${response.status} ${response.statusText}.`);
      }

      const results = Array.isArray(body.results) ? body.results : [];
      setTextResults(results);
      setTextStatus("ready");
      recordSearchMetric({
        query: normalized,
        mode: "text",
        durationMs: performance.now() - startedAt,
        resultCount: results.length,
        status: "ready",
      });
    } catch (error) {
      setTextResults([]);
      setTextStatus("error");
      setTextError(error instanceof Error ? error.message : "Search failed.");
      recordSearchMetric({
        query: normalized,
        mode: "text",
        durationMs: performance.now() - startedAt,
        resultCount: 0,
        status: "error",
      });
    }
  }, []);

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

    fetch("/api/ai-search", {
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
  }, [query]);

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
          aria-activedescendant={(mode === "ai" ? aiResults : textResults)[activeIndex] ? `search-result-${activeIndex}` : undefined}
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
