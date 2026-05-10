import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { hrefForSlug } from "../wiki-utils";

type SearchResult = {
  slug: string;
  title: string;
  tags?: string[];
  excerpt?: string;
  relevance?: number;
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
    setQuery(normalized);
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
      return;
    }

    const textBody = (await textResponse.json()) as { results?: SearchResult[] };
    const textResults = Array.isArray(textBody.results) ? textBody.results : [];
    if (nextMode === "text") {
      setResults(textResults);
      setStatus("ready");
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
      return;
    }
    const aiBody = (await aiResponse.json()) as { results?: SearchResult[] };
    setResults(Array.isArray(aiBody.results) ? aiBody.results : []);
    setStatus("ready");
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

  return (
    <article className="search-page" data-test-id="search-page">
      <header className="search-page-header">
        <p className="eyebrow">Backend search</p>
        <h1>Search wiki</h1>
        {returnTo ? <Link to={returnTo}>Back to reader</Link> : null}
      </header>
      <form className="search-page-form" onSubmit={onSubmit}>
        <input
          aria-label="Search wiki"
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search across wiki pages"
          value={query}
        />
        <button disabled={!trimmedQuery || status === "loading" || status === "ranking"} type="submit">
          Search
        </button>
      </form>
      <div aria-label="Search mode" className="search-mode-toggle" role="group">
        <button
          aria-pressed={mode === "text"}
          onClick={() => onModeChange("text")}
          type="button"
        >
          Text
        </button>
        <button
          aria-pressed={mode === "ai"}
          onClick={() => onModeChange("ai")}
          type="button"
        >
          AI
        </button>
      </div>
      <section className="search-page-results" data-test-id="search-results">
        <div className="search-page-status">{resultLabel}</div>
        {error ? <p className="auth-error">{error}</p> : null}
        {status === "ready" && results.length === 0 ? (
          <p className="search-page-empty">No results</p>
        ) : null}
        {results.map((result) => (
          <Link className="search-page-result" key={result.slug} to={hrefForSlug(result.slug)}>
            <strong>{result.title}</strong>
            <span>
              {result.slug}
              {typeof result.relevance === "number" ? ` · ${result.relevance.toFixed(1)} relevance` : ""}
            </span>
            {result.summary ? <p>{result.summary}</p> : result.excerpt ? <p>{result.excerpt}</p> : null}
          </Link>
        ))}
      </section>
    </article>
  );
}
