"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { searchMarkdown, type SearchResult } from "@/lib/search";

function HighlightedLine({
  line,
  matchStart,
  matchEnd,
}: {
  line: string;
  matchStart: number;
  matchEnd: number;
}) {
  const before = line.slice(0, matchStart);
  const match = line.slice(matchStart, matchEnd);
  const after = line.slice(matchEnd);

  return (
    <span>
      {before}
      <span className="bg-[#e2ac4a] text-[#1a1a2e] rounded-sm px-px">
        {match}
      </span>
      {after}
    </span>
  );
}

function FileResult({
  result,
  collapsed,
  onToggle,
}: {
  result: SearchResult;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathParts = result.slug.split("/");
  const fileName = pathParts.pop() || "";
  const dirPath = pathParts.join("/");

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-[var(--sidebar-bg)] rounded transition-colors group"
      >
        <span className="text-xs opacity-50 w-4 text-center">
          {collapsed ? "▶" : "▼"}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className="shrink-0 opacity-70"
          fill="currentColor"
        >
          <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
        </svg>
        <span className="font-semibold text-sm text-[var(--foreground)]">
          {fileName}
        </span>
        {dirPath && (
          <span className="text-xs text-[var(--text-muted)] truncate">
            {dirPath}
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--text-muted)] bg-[var(--sidebar-bg)] px-1.5 py-0.5 rounded-full">
          {result.matches.length}
        </span>
      </button>

      {!collapsed && (
        <div className="ml-6 border-l border-[var(--sidebar-border)]">
          {result.matches.map((match, i) => (
            <Link
              key={i}
              href={`/${result.slug}`}
              className="flex items-start gap-3 px-3 py-0.5 hover:bg-[var(--sidebar-bg)] transition-colors text-sm font-mono group"
            >
              <span className="text-[var(--text-muted)] text-xs w-8 text-right shrink-0 pt-px select-none">
                {match.lineNumber}
              </span>
              <span className="text-[var(--foreground)] opacity-80 truncate leading-relaxed">
                <HighlightedLine
                  line={match.lineContent}
                  matchStart={match.matchStart}
                  matchEnd={match.matchEnd}
                />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q") || "";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState(query);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await searchMarkdown(q);
      setResults(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) {
      doSearch(query);
    }
  }, [query, doSearch]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(inputValue)}`);
  }

  function toggleFile(slug: string) {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);

  return (
    <div className="overflow-y-auto h-full">
    <div className="max-w-3xl px-4 py-4 md:px-8 md:py-8">
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="relative">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
          >
            <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
          </svg>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search files..."
            autoFocus
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-mono placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)] transition-colors"
          />
        </div>
      </form>

      {loading && (
        <div className="text-sm text-[var(--text-muted)] py-4">Searching...</div>
      )}

      {!loading && query && results.length === 0 && (
        <div className="text-sm text-[var(--text-muted)] py-4">
          No results for &quot;{query}&quot;
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          <div className="text-xs text-[var(--text-muted)] mb-3 px-2">
            {totalMatches} result{totalMatches !== 1 ? "s" : ""} in{" "}
            {results.length} file{results.length !== 1 ? "s" : ""}
          </div>

          <div>
            {results.map((result) => (
              <FileResult
                key={result.slug}
                result={result}
                collapsed={collapsedFiles.has(result.slug)}
                onToggle={() => toggleFile(result.slug)}
              />
            ))}
          </div>
        </>
      )}

      {!query && !loading && (
        <div className="text-sm text-[var(--text-muted)] py-8 text-center">
          Type a query to search across all wiki pages
        </div>
      )}
    </div>
    </div>
  );
}
