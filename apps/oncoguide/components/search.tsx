"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { educationHref, type GuidePage } from "../lib/routes";
type SearchPage = Omit<GuidePage, "html">;
export function EducationSearch() {
  const query = useSearchParams().get("q")?.trim() ?? "";
  const [pages, setPages] = useState<SearchPage[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/search-index.json", { signal: controller.signal }).then(response => {
      if (!response.ok) throw Error("Search unavailable");
      return response.json();
    }).then(setPages).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = query.length < 2 ? [] : pages.filter(page => terms.every(term => `${page.title} ${page.description ?? ""} ${page.text}`.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.title.toLowerCase().includes(query.toLowerCase())) - Number(a.title.toLowerCase().includes(query.toLowerCase())));
  return <section className="edu-search-results"><div className="edu-eyebrow">SEARCH THE LIBRARY</div>
    <h1>{query ? `Results for “${query}”` : "Search education"}</h1>
    {error ? <p role="alert">Search could not load. Please reload and try again.</p> : !pages.length ? <p role="status">Loading search…</p> : <p>{query.length < 2 ? "Enter at least two characters in the search above." : `${results.length} matching lessons`}</p>}
    {results.map(page => {
      const index = page.text.toLowerCase().indexOf(terms[0]!);
      const excerpt = page.description ?? `${index > 50 ? "…" : ""}${page.text.slice(Math.max(0, index - 50), Math.max(0, index - 50) + 220)}…`;
      return <Link className="edu-result" href={educationHref(page.slug)} key={page.slug}><h2>{page.title}</h2><p>{excerpt}</p></Link>;
    })}
  </section>;
}
