"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { searchMarkdown, type SearchResult } from "@/lib/search";

interface AISearchResult {
  slug: string;
  title: string;
  tags: string[];
  relevance: number;
  summary: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightQuery(text: string, query: string): string {
  if (!query.trim()) return text;
  const pattern = escapeRegex(query.trim());
  const regex = new RegExp(`(${pattern})`, "gi");
  return text.replace(regex, "<mark>$1</mark>");
}

interface DirNode {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: SearchResult[];
  totalMatches: number;
}

function buildTree(results: SearchResult[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: new Map(), files: [], totalMatches: 0 };

  for (const result of results) {
    const parts = result.slug.split("/");
    const fileName = parts.pop()!;
    let node = root;

    for (const part of parts) {
      if (!node.dirs.has(part)) {
        const childPath = node.path ? `${node.path}/${part}` : part;
        node.dirs.set(part, { name: part, path: childPath, dirs: new Map(), files: [], totalMatches: 0 });
      }
      node = node.dirs.get(part)!;
    }

    node.files.push({ ...result, slug: result.slug, title: fileName });
  }

  // Roll up match counts
  function countMatches(node: DirNode): number {
    let total = node.files.reduce((s, f) => s + f.matches.length, 0);
    for (const child of node.dirs.values()) {
      total += countMatches(child);
    }
    node.totalMatches = total;
    return total;
  }
  countMatches(root);

  return root;
}

function FileMatches({ result, collapsed, onToggle, query }: {
  result: SearchResult;
  collapsed: boolean;
  onToggle: () => void;
  query: string;
}) {
  const fileName = result.title || result.slug.split("/").pop() || "";

  return (
    <div className="mb-0.5">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left px-2 py-1 hover:bg-[var(--sidebar-bg)] rounded transition-colors"
      >
        <span className="text-xs opacity-50 w-4 text-center">
          {collapsed ? "▶" : "▼"}
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 opacity-50" fill="currentColor">
          <path d="M13 4H8.4l-.6-.6-.3-.4H3l-.5.5v9l.5.5h10l.5-.5V4.5L13 4zm-.5 8h-9V4.5h3.6l.8.8.2.2H12.5v6.5z" />
        </svg>
        <span className="text-sm text-[var(--foreground)]">{fileName}</span>
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
              className="flex items-start gap-3 px-3 py-0.5 hover:bg-[var(--sidebar-bg)] transition-colors text-sm"
            >
              <span className="text-[var(--text-muted)] text-xs w-8 text-right shrink-0 pt-1 select-none font-mono">
                {match.lineNumber}
              </span>
              <span className="text-[var(--foreground)] opacity-80 leading-relaxed break-words max-w-none [&>*]:m-0 [&_a]:text-[var(--brand)] [&_a]:no-underline [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_h4]:text-sm [&_h4]:font-medium [&_strong]:font-semibold [&_code]:bg-[var(--sidebar-bg)] [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_table]:text-xs [&_table]:border-collapse [&_th]:text-left [&_th]:pr-3 [&_th]:font-semibold [&_th]:border-b [&_th]:border-[var(--sidebar-border)] [&_td]:pr-3 [&_td]:py-0.5 [&_td]:border-b [&_td]:border-[var(--sidebar-border)] [&_li]:list-disc [&_li]:ml-4 [&_mark]:bg-[var(--brand)]/15 [&_mark]:text-[var(--brand)] [&_mark]:rounded-sm [&_mark]:px-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {highlightQuery(match.lineContent, query)}
                </ReactMarkdown>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DirTree({ node, depth, collapsed, onToggleDir, onToggleFile, collapsedFiles, query }: {
  node: DirNode;
  depth: number;
  collapsed: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleFile: (slug: string) => void;
  collapsedFiles: Set<string>;
  query: string;
}) {
  const isCollapsed = collapsed.has(node.path);
  const sortedDirs = Array.from(node.dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
  const sortedFiles = [...node.files].sort((a, b) => b.matches.length - a.matches.length);

  return (
    <div style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
      {depth > 0 && (
        <button
          onClick={() => onToggleDir(node.path)}
          className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-[var(--sidebar-bg)] rounded transition-colors"
        >
          <span className="text-xs opacity-50 w-4 text-center">
            {isCollapsed ? "▶" : "▼"}
          </span>
          <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 opacity-70" fill="currentColor">
            <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
          </svg>
          <span className="font-medium text-sm text-[var(--foreground)]">{node.name}</span>
          <span className="ml-auto text-xs text-[var(--text-muted)] bg-[var(--sidebar-bg)] px-1.5 py-0.5 rounded-full">
            {node.totalMatches}
          </span>
        </button>
      )}

      {!isCollapsed && (
        <div>
          {sortedDirs.map((dir) => (
            <DirTree
              key={dir.path}
              node={dir}
              depth={depth + 1}
              collapsed={collapsed}
              onToggleDir={onToggleDir}
              onToggleFile={onToggleFile}
              collapsedFiles={collapsedFiles}
              query={query}
            />
          ))}
          {sortedFiles.map((result) => (
            <div key={result.slug} style={{ paddingLeft: 8 }}>
              <FileMatches
                result={result}
                collapsed={collapsedFiles.has(result.slug)}
                onToggle={() => onToggleFile(result.slug)}
                query={query}
              />
            </div>
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
  const query = searchParams.get("q") || "";
  const [tab, setTab] = useState<"text" | "ai">("ai");
  const [textResults, setTextResults] = useState<SearchResult[]>([]);
  const [textLoading, setTextLoading] = useState(false);

  // Shared text search — runs once, feeds both tabs
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setTextResults([]);
      return;
    }
    setTextLoading(true);
    try {
      const res = await searchMarkdown(q);
      setTextResults(res);
    } finally {
      setTextLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) doSearch(query);
  }, [query, doSearch]);

  // Deduplicated slugs from text results for AI mode
  const slugs = useMemo(() => {
    const seen = new Set<string>();
    return textResults
      .sort((a, b) => b.matches.length - a.matches.length)
      .filter((r) => {
        if (seen.has(r.slug)) return false;
        seen.add(r.slug);
        return true;
      })
      .slice(0, 12)
      .map((r) => r.slug);
  }, [textResults]);

  return (
    <div className="overflow-y-auto h-full">
      <div className="px-2 py-4 md:px-4 md:py-6">
        {query && (
          <div className="flex items-center gap-1 mb-4 px-2">
            <div className="inline-flex rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-0.5">
              <button
                onClick={() => setTab("ai")}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
                  tab === "ai"
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2l1.5 4.5H14l-3.5 2.5L12 14 8 11l-4 3 1.5-5L2 6.5h4.5z" />
                </svg>
                AI Mode
              </button>
              <button
                onClick={() => setTab("text")}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  tab === "text"
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Text Search
              </button>
            </div>
          </div>
        )}

        {tab === "text" ? (
          <TextSearch query={query} results={textResults} loading={textLoading} />
        ) : (
          <AISearch query={query} slugs={slugs} loading={textLoading} />
        )}
      </div>
    </div>
  );
}

function TextSearch({
  query,
  results,
  loading,
}: {
  query: string;
  results: SearchResult[];
  loading: boolean;
}) {
  const [prevResults, setPrevResults] = useState(results);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  // Reset collapse state when results change (state adjustment during render)
  if (results !== prevResults) {
    setPrevResults(results);
    setCollapsedDirs(new Set());
    setCollapsedFiles(new Set());
  }

  const tree = useMemo(() => buildTree(results), [results]);

  function toggleDir(path: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)] py-4">Searching...</div>;
  }

  if (query && results.length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] py-4">
        No results for &quot;{query}&quot;
      </div>
    );
  }

  if (results.length > 0) {
    return (
      <>
        <div className="text-xs text-[var(--text-muted)] mb-3 px-2">
          {totalMatches} result{totalMatches !== 1 ? "s" : ""} in{" "}
          {results.length} file{results.length !== 1 ? "s" : ""}
        </div>
        <DirTree
          node={tree}
          depth={0}
          collapsed={collapsedDirs}
          onToggleDir={toggleDir}
          onToggleFile={toggleFile}
          collapsedFiles={collapsedFiles}
          query={query}
        />
      </>
    );
  }

  return (
    <div className="text-sm text-[var(--text-muted)] py-8 text-center">
      Type a query to search across all wiki pages
    </div>
  );
}

function AISearch({
  query,
  slugs,
  loading: textLoading,
}: {
  query: string;
  slugs: string[];
  loading: boolean;
}) {
  const [results, setResults] = useState<AISearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stringify slugs for stable dependency comparison
  const slugsKey = slugs.join(",");

  useEffect(() => {
    // Wait for text search to finish before firing AI search
    if (textLoading) {
      setLoading(true);
      return;
    }

    if (!query || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    if (slugs.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/ai-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, slugs }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!cancelled) {
          if (data.error) {
            setError(data.error);
          } else {
            setResults(data.results ?? []);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, slugsKey, textLoading]);

  if (!query) {
    return (
      <div className="text-sm text-[var(--text-muted)] py-8 text-center">
        Type a query to search across all wiki pages
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4 px-2">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Analyzing results with AI...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 py-4 px-2">
        Search failed: {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] py-4 px-2">
        No relevant results for &quot;{query}&quot;
      </div>
    );
  }

  return (
    <div className="space-y-2 px-2">
      <div className="text-xs text-[var(--text-muted)] mb-3">
        {results.length} result{results.length !== 1 ? "s" : ""} ranked by relevance
      </div>
      {results.map((r) => (
        <Link
          key={r.slug}
          href={`/${r.slug}`}
          className="block rounded-lg border border-[var(--sidebar-border)] p-3 hover:border-[var(--brand)]/40 hover:bg-[var(--accent-light)] transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-[var(--foreground)] truncate">
                {r.title}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                {r.slug}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-[var(--brand)]/10 text-[var(--brand)]">
              {r.relevance}/10
            </span>
          </div>
          <p className="text-xs text-[var(--foreground)]/80 mt-2 leading-relaxed">
            {r.summary}
          </p>
          {r.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {r.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--sidebar-bg)] text-[var(--text-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}
