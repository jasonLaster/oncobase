import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { hrefForSlug } from "../wiki-utils";

type SearchResult = {
  slug: string;
  title: string;
  tags?: string[];
  excerpt?: string;
};

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialQuery = params.get("q") ?? "";
  const returnTo = params.get("returnTo");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    initialQuery ? "loading" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const trimmedQuery = query.trim();
  const resultLabel = useMemo(() => {
    if (status === "loading") return "Searching";
    if (status === "ready") return `${results.length} result${results.length === 1 ? "" : "s"}`;
    return "Search wiki";
  }, [results.length, status]);

  useEffect(() => {
    if (!initialQuery) return;
    void runSearch(initialQuery);
  }, [initialQuery]);

  async function runSearch(nextQuery = trimmedQuery) {
    const normalized = nextQuery.trim();
    setQuery(normalized);
    if (!normalized) {
      setStatus("idle");
      setResults([]);
      return;
    }

    setStatus("loading");
    setError(null);
    const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}&limit=20`);
    if (!response.ok) {
      setStatus("error");
      setError(`Search failed with ${response.status}`);
      return;
    }

    const body = (await response.json()) as { results?: SearchResult[] };
    setResults(Array.isArray(body.results) ? body.results : []);
    setStatus("ready");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextParams = new URLSearchParams();
    if (trimmedQuery) nextParams.set("q", trimmedQuery);
    if (returnTo) nextParams.set("returnTo", returnTo);
    const nextSearch = nextParams.toString();
    navigate(`/search${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
    void runSearch(trimmedQuery);
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
        <button disabled={!trimmedQuery || status === "loading"} type="submit">
          Search
        </button>
      </form>
      <section className="search-page-results" data-test-id="search-results">
        <div className="search-page-status">{resultLabel}</div>
        {error ? <p className="auth-error">{error}</p> : null}
        {status === "ready" && results.length === 0 ? (
          <p className="search-page-empty">No results</p>
        ) : null}
        {results.map((result) => (
          <Link className="search-page-result" key={result.slug} to={hrefForSlug(result.slug)}>
            <strong>{result.title}</strong>
            <span>{result.slug}</span>
            {result.excerpt ? <p>{result.excerpt}</p> : null}
          </Link>
        ))}
      </section>
    </article>
  );
}
