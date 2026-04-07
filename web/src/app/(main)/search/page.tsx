"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { searchMarkdown, type SearchResult } from "@/lib/search";

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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(results), [results]);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await searchMarkdown(q);
      setResults(res);
      setCollapsedDirs(new Set());
      setCollapsedFiles(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) {
      doSearch(query);
    }
  }, [query, doSearch]);

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

  return (
    <div className="overflow-y-auto h-full">
    <div className="px-2 py-4 md:px-4 md:py-6">
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
