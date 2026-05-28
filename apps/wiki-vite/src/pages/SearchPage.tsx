import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  WikiSearchForm,
  WikiSearchHeader,
  WikiSearchInput,
  WikiSearchModeToggle,
  WikiSearchPage,
  WikiSearchResultLink,
  WikiSearchResults,
  WikiSearchSubmitButton,
} from "@diana-tnbc/wiki-shell";
import { recordSearchMetric } from "../observability";
import { hrefForSlug } from "../wiki-utils";

type SearchResult = {
  slug: string;
  title: string;
  tags?: string[];
  excerpt?: string;
  relevance?: number;
  sensitive?: boolean;
  sources?: Array<{ label?: string; title: string; href?: string }>;
  summary?: string;
};

type SearchMode = "text" | "ai";

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialQuery = params.get("q") ?? "";
  const initialMode: SearchMode = params.get("mode") === "ai" ? "ai" : "text";
  const returnTo = params.get("returnTo");
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ranking" | "ready" | "error">(
    initialQuery ? "loading" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const trimmedQuery = query.trim();
  const resultLabel = useMemo(() => {
    if (status === "loading") return "Searching";
    if (status === "ranking") return "Ranking with AI";
    if (status === "ready") return `${results.length} result${results.length === 1 ? "" : "s"}`;
    return "Search wiki";
  }, [results.length, status]);

  useEffect(() => {
    setMode(initialMode);
    if (!initialQuery) return;
    void runSearch(initialQuery, initialMode);
  }, [initialMode, initialQuery]);

  async function runSearch(nextQuery = trimmedQuery, nextMode = mode) {
    const normalized = nextQuery.trim();
    const startedAt = performance.now();
    setQuery(normalized);
    setActiveIndex(0);
    if (!normalized) {
      setStatus("idle");
      setResults([]);
      return;
    }

    setStatus("loading");
    setError(null);
    const textResponse = await fetch(`/api/search?q=${encodeURIComponent(normalized)}&limit=20`);
    if (!textResponse.ok) {
      setStatus("error");
      setError(`Search failed with ${textResponse.status}`);
      recordSearchMetric({
        query: normalized,
        mode: nextMode,
        durationMs: performance.now() - startedAt,
        resultCount: 0,
        status: "error",
      });
      return;
    }

    const textBody = (await textResponse.json()) as { results?: SearchResult[] };
    const textResults = Array.isArray(textBody.results) ? textBody.results : [];
    if (nextMode === "text") {
      setResults(textResults);
      setStatus("ready");
      recordSearchMetric({
        query: normalized,
        mode: "text",
        durationMs: performance.now() - startedAt,
        resultCount: textResults.length,
        status: "ready",
      });
      return;
    }

    setStatus("ranking");
    const aiResponse = await fetch("/api/ai-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: normalized,
        slugs: textResults.map((result) => result.slug),
      }),
    });
    if (!aiResponse.ok) {
      const body = (await aiResponse.json().catch(() => null)) as { error?: string } | null;
      setStatus("error");
      setError(body?.error ?? `AI search failed with ${aiResponse.status}`);
      setResults(textResults);
      recordSearchMetric({
        query: normalized,
        mode: "ai",
        durationMs: performance.now() - startedAt,
        resultCount: textResults.length,
        status: "error",
      });
      return;
    }
    const aiBody = (await aiResponse.json()) as { results?: SearchResult[] };
    const aiResults = Array.isArray(aiBody.results) ? aiBody.results : [];
    setResults(aiResults);
    setStatus("ready");
    recordSearchMetric({
      query: normalized,
      mode: "ai",
      durationMs: performance.now() - startedAt,
      resultCount: aiResults.length,
      status: "ready",
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextParams = new URLSearchParams();
    if (trimmedQuery) nextParams.set("q", trimmedQuery);
    if (mode === "ai") nextParams.set("mode", "ai");
    if (returnTo) nextParams.set("returnTo", returnTo);
    const nextSearch = nextParams.toString();
    navigate(`/search${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
    void runSearch(trimmedQuery, mode);
  }

  function onModeChange(nextMode: SearchMode) {
    setMode(nextMode);
    const nextParams = new URLSearchParams();
    if (trimmedQuery) nextParams.set("q", trimmedQuery);
    if (nextMode === "ai") nextParams.set("mode", "ai");
    if (returnTo) nextParams.set("returnTo", returnTo);
    const nextSearch = nextParams.toString();
    navigate(`/search${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
    if (trimmedQuery) void runSearch(trimmedQuery, nextMode);
  }

  function onResultsKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      navigate(hrefForSlug(results[activeIndex]?.slug ?? results[0].slug));
    }
  }

  return (
    <WikiSearchPage data-test-id="search-page">
      <WikiSearchHeader
        action={returnTo ? <Link to={returnTo}>Back to reader</Link> : null}
        eyebrow="Backend search"
        heading="Search wiki"
      />
      <WikiSearchForm onSubmit={onSubmit}>
        <WikiSearchInput
          aria-label="Search wiki"
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search across wiki pages"
          value={query}
        />
        <WikiSearchSubmitButton disabled={!trimmedQuery || status === "loading" || status === "ranking"}>
          Search
        </WikiSearchSubmitButton>
      </WikiSearchForm>
      <WikiSearchModeToggle
        options={[
          {
            key: "text",
            label: "Text",
            onSelect: () => onModeChange("text"),
            pressed: mode === "text",
          },
          {
            key: "ai",
            label: "AI",
            onSelect: () => onModeChange("ai"),
            pressed: mode === "ai",
          },
        ]}
      />
      <WikiSearchResults
        aria-activedescendant={results[activeIndex] ? `search-result-${activeIndex}` : undefined}
        aria-label="Search results"
        data-test-id="search-results"
        emptyMessage={status === "ready" && results.length === 0 ? "No results" : undefined}
        error={error}
        onKeyDown={onResultsKeyDown}
        statusLabel={resultLabel}
        tabIndex={results.length > 0 ? 0 : -1}
      >
        {results.map((result, index) => (
          <WikiSearchResultLink
            active={index === activeIndex}
            excerpt={result.excerpt}
            href={hrefForSlug(result.slug)}
            id={`search-result-${index}`}
            key={result.slug}
            onFocus={() => setActiveIndex(index)}
            relevance={result.relevance}
            renderLink={({ href, children, ...linkProps }) => (
              <Link {...linkProps} to={href}>
                {children}
              </Link>
            )}
            sensitive={result.sensitive}
            slug={result.slug}
            sources={
              result.sources ??
              (mode === "ai"
                ? [
                    {
                      label: "source",
                      title: result.title,
                      href: hrefForSlug(result.slug),
                    },
                  ]
                : undefined)
            }
            summary={result.summary}
            tags={result.tags}
            title={result.title}
          />
        ))}
      </WikiSearchResults>
    </WikiSearchPage>
  );
}
