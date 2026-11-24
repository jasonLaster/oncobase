import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Input, InputClear, InputGroup } from "@oncobase/ui/input";
import { Listbox, ListboxItem } from "@oncobase/ui/listbox";
import { SegmentedControl, SegmentedControlItem } from "@oncobase/ui/segmented-control";
import { Tree, TreeGroup, TreeItem, TreeItemIndicator, TreeItemLabel } from "@oncobase/ui/tree";
import ReactMarkdown from "react-markdown";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  protectCurrencyFromMath,
} from "@oncobase/wiki-markdown/math";
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
  body: {
    complete?: boolean;
    error?: string;
    results?: TextSearchResult[];
    retryAfterMs?: number;
  };
  durationMs: number;
  ok: boolean;
  status: number;
  statusText: string;
};

// Search routes run for at most 60 s on the server; give up shortly after so
// a stalled connection surfaces an error instead of spinning forever.
const SEARCH_REQUEST_TIMEOUT_MS = 65_000;

function abortAfter(controller: AbortController, ms: number, message: string) {
  const timer = window.setTimeout(() => controller.abort(new DOMException(message, "TimeoutError")), ms);
  return () => window.clearTimeout(timer);
}

function searchErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "TimeoutError") return error.message;
  return error instanceof Error ? error.message : fallback;
}

type PendingTextSearch = {
  controller: AbortController;
  promise: Promise<TextSearchResponse>;
  subscribers: number;
};

// Identical queries share one request. It is aborted once every subscriber
// has moved on (a newer query, navigation or unmount). The abort waits one
// task so an immediate remount (StrictMode, a re-keyed effect) can reuse it.
const pendingTextSearchRequests = new Map<string, PendingTextSearch>();

// A cold server answers within a short budget from its relevance index
// (`complete: false`). The background retry asks it to wait for the exhaustive
// corpus instead: indexed results are already on screen.
const SEARCH_WAIT_HEADER = "X-Wiki-Search-Wait";
// Each retry may reach another cold instance; stop after a few.
const MAX_TEXT_SEARCH_RETRIES = 3;

function requestTextSearch(searchParams: URLSearchParams, signal: AbortSignal, waitForExhaustive = false) {
  const key = `${searchParams}${waitForExhaustive ? "#exhaustive" : ""}`;
  let entry = pendingTextSearchRequests.get(key);
  if (!entry) entry = startTextSearch(key, searchParams, waitForExhaustive);
  const current = entry;
  current.subscribers += 1;
  signal.addEventListener("abort", () => {
    current.subscribers -= 1;
    window.setTimeout(() => {
      if (current.subscribers > 0 || pendingTextSearchRequests.get(key) !== current) return;
      pendingTextSearchRequests.delete(key);
      current.controller.abort();
    }, 0);
  }, { once: true });
  return current.promise;
}

function startTextSearch(key: string, searchParams: URLSearchParams, waitForExhaustive: boolean): PendingTextSearch {
  const query = searchParams.get("q") ?? "";
  const startedAt = performance.now();
  const controller = new AbortController();
  const cancelTimeout = abortAfter(controller, SEARCH_REQUEST_TIMEOUT_MS, "Search timed out.");
  const promise = fetch(`/api/search?${searchParams}`, {
    signal: controller.signal,
    ...(waitForExhaustive ? { headers: { [SEARCH_WAIT_HEADER]: "exhaustive" } } : {}),
  }).then(async (response) => ({
    body: await readJsonBody<TextSearchResponse["body"]>(response),
    durationMs: performance.now() - startedAt,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  }));
  const entry: PendingTextSearch = { controller, promise, subscribers: 0 };
  pendingTextSearchRequests.set(key, entry);
  const clearPending = () => {
    cancelTimeout();
    if (pendingTextSearchRequests.get(key) === entry) {
      pendingTextSearchRequests.delete(key);
    }
  };
  void promise.then(
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
    (error: unknown) => {
      clearPending();
      // A superseded search is not a failure; a timeout is.
      if (controller.signal.aborted && !(error instanceof DOMException && error.name === "TimeoutError")) return;
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
  return entry;
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
      <InputGroup className="relative">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
          fill="currentColor"
          height="16"
          viewBox="0 0 16 16"
          width="16"
        >
          <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
        </svg>
        <Input
          aria-label="Search the wiki"
          autoFocus={!query}
          className="w-full rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] py-2 pl-10 pr-9 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
          data-test-id="search-form-input"
          name="q"
          onValueChange={setDraft}
          placeholder="Search the wiki…"
          type="text"
          value={draft}
        />
        <InputClear
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--sidebar-bg)] hover:text-[var(--foreground)]"
        >
          <svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 12 12" width="12">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </InputClear>
      </InputGroup>
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
  const itemClass = (checked: boolean) =>
    `flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors ${
      checked
        ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
        : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
    }`;
  return (
    <div className="mb-4 flex items-center gap-1 px-2">
      <SegmentedControl
        aria-label="Search mode"
        className="inline-flex rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-0.5"
        onValueChange={(next) => {
          if (next === "ai" || next === "text") onModeChange(next);
        }}
        value={mode}
      >
        <SegmentedControlItem
          className={(state) => itemClass(state.checked)}
          data-test-id="search-tab-ai"
          value="ai"
        >
          <svg
            aria-hidden="true"
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
        </SegmentedControlItem>
        <SegmentedControlItem
          className={(state) => itemClass(state.checked)}
          data-test-id="search-tab-text"
          value="text"
        >
          Text Search
        </SegmentedControlItem>
      </SegmentedControl>
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

const directoryValue = (path: string) => `d:${path}`;
const fileValue = (result: TextSearchTreeResult) => `f:${result.resultIndex}`;

function treeBranchValues(node: SearchDirectory, values: string[] = []) {
  for (const directory of node.dirs.values()) {
    values.push(directoryValue(directory.path));
    treeBranchValues(directory, values);
  }
  for (const file of node.files) values.push(fileValue(file));
  return values;
}

function TreeExpandIcon() {
  return (
    <TreeItemIndicator className="w-4 text-center text-xs opacity-50">
      {(state) => (state.expanded ? "▼" : "▶")}
    </TreeItemIndicator>
  );
}

function FileMatches({ query, result }: { query: string; result: TextSearchTreeResult }) {
  return (
    <TreeItem
      className="search-page-result mb-0.5 rounded"
      data-slug={result.slug}
      label={result.title}
      style={{ paddingLeft: 8 }}
      value={fileValue(result)}
    >
      <TreeItemLabel
        className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--sidebar-bg)]"
        data-test-id="search-text-file"
      >
        <TreeExpandIcon />
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
      </TreeItemLabel>
      <TreeGroup className="ml-6 border-l border-[var(--sidebar-border)]">
        {result.matches.map((match, index) => (
          <TreeItem
            key={`${result.slug}-${match.lineNumber}-${index}`}
            label={match.lineContent}
            value={`m:${result.resultIndex}:${index}`}
          >
            <TreeItemLabel
              className="flex items-start gap-3 px-3 py-0.5 text-sm transition-colors hover:bg-[var(--sidebar-bg)]"
              data-test-id="search-text-result"
              render={<Link to={hrefForSlug(result.slug)} />}
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
            </TreeItemLabel>
          </TreeItem>
        ))}
      </TreeGroup>
    </TreeItem>
  );
}

function DirectoryItems({ node, query }: { node: SearchDirectory; query: string }) {
  const directories = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => b.matches.length - a.matches.length);

  return (
    <>
      {directories.map((directory) => (
        <TreeItem
          key={directory.path}
          label={directory.name}
          style={{ paddingLeft: 8 }}
          value={directoryValue(directory.path)}
        >
          <TreeItemLabel
            className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-bg)]"
            data-path={directory.path}
            data-test-id="search-text-directory"
          >
            <TreeExpandIcon />
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
            <span className="text-sm font-medium text-[var(--foreground)]">{directory.name}</span>
            <span className="ml-auto rounded-full bg-[var(--sidebar-bg)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
              {directory.totalMatches}
            </span>
          </TreeItemLabel>
          <TreeGroup>
            <DirectoryItems node={directory} query={query} />
          </TreeGroup>
        </TreeItem>
      ))}
      {files.map((result) => (
        <FileMatches key={result.resultIndex} query={query} result={result} />
      ))}
    </>
  );
}

function TextSearch({
  error,
  incomplete,
  query,
  results,
  status,
}: {
  error: string | null;
  incomplete: boolean;
  query: string;
  results: TextSearchResult[];
  status: SearchStatus;
}) {
  // Branches start expanded, including ones a background retry adds later.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const normalizedResults = useMemo(() => normalizeTextResults(results), [results]);
  const tree = useMemo(() => buildSearchTree(normalizedResults), [normalizedResults]);
  const branches = useMemo(() => treeBranchValues(tree), [tree]);
  const expanded = useMemo(() => branches.filter((value) => !collapsed.has(value)), [branches, collapsed]);

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

  return (
    <div>
      <div
        className="mb-3 px-2 text-xs text-[var(--text-muted)]"
        data-test-id="search-text-summary"
      >
        {totalMatches} result{totalMatches !== 1 ? "s" : ""} in{" "}
        {normalizedResults.length} file{normalizedResults.length !== 1 ? "s" : ""}
        {incomplete ? <output aria-live="polite"> (full results loading…)</output> : null}
      </div>
      <Tree
        aria-label="Text search results"
        className="search-text-tree"
        expandOnPress
        expanded={expanded}
        mode="none"
        onExpandedChange={(next) => {
          const open = new Set(next);
          setCollapsed(new Set(branches.filter((value) => !open.has(value))));
        }}
      >
        <DirectoryItems node={tree} query={query} />
      </Tree>
    </div>
  );
}

function AISearch({
  error,
  query,
  results,
  status,
}: {
  error: string | null;
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
      <Listbox activation="manual" aria-label="AI search results" className="space-y-2">
      {results.map((result) => (
        <ListboxItem
          className={(state) =>
            `search-page-result block rounded-lg border border-[var(--sidebar-border)] p-3 no-underline transition-colors hover:border-[var(--brand)] hover:bg-[var(--accent-light)] ${
              state.highlighted ? "active border-[var(--brand)] bg-[var(--accent-light)]" : ""
            }`
          }
          data-test-id="search-ai-result"
          key={result.slug}
          label={result.title}
          render={<Link to={hrefForSlug(result.slug)} />}
          value={result.slug}
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
        </ListboxItem>
      ))}
      </Listbox>
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
  const [textIncomplete, setTextIncomplete] = useState(false);
  const [textRetryAfterMs, setTextRetryAfterMs] = useState(0);
  // Background retries so far for the current query; each incomplete response
  // schedules the next (bounded) retry.
  const [textRetries, setTextRetries] = useState(0);
  const textRequestGeneration = useRef(0);
  const textRequestController = useRef<AbortController | null>(null);
  const [aiResults, setAiResults] = useState<AISearchResult[]>([]);
  const [aiStatus, setAiStatus] = useState<SearchStatus>(query ? "loading" : "idle");
  const [aiError, setAiError] = useState<string | null>(null);

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

  const runTextSearch = useCallback(async (nextQuery: string, background = false) => {
    textRequestController.current?.abort();
    const controller = new AbortController();
    textRequestController.current = controller;
    const generation = ++textRequestGeneration.current;
    const normalized = nextQuery.trim();
    setTextResultsQuery(normalized);

    if (normalized.length < 2) {
      setTextResults([]);
      setTextStatus(normalized ? "ready" : "idle");
      setTextError(null);
      setTextIncomplete(false);
      return;
    }

    if (!background) {
      setTextStatus("loading");
      setTextError(null);
      setTextIncomplete(false);
      setTextRetryAfterMs(0);
      setTextRetries(0);
    }

    try {
      const searchParams = new URLSearchParams({ q: normalized, scope });
      const response = await requestTextSearch(searchParams, controller.signal, background);
      if (generation !== textRequestGeneration.current) return;
      const { body } = response;
      if (body.error) throw new Error(body.error);
      if (!response.ok) {
        throw new Error(`Search failed with ${response.status} ${response.statusText}.`);
      }

      const results = Array.isArray(body.results) ? body.results : [];
      setTextResults(results);
      setTextStatus("ready");
      setTextIncomplete(body.complete === false);
      setTextRetryAfterMs(
        body.complete === false && Number.isFinite(body.retryAfterMs)
          ? Math.max(1_000, Number(body.retryAfterMs))
          : 0,
      );
      if (background) setTextRetries((count) => count + 1);
    } catch (error) {
      if (generation !== textRequestGeneration.current) return;
      if (background) {
        setTextIncomplete(false);
        return;
      }
      setTextResults([]);
      setTextStatus("error");
      setTextError(searchErrorMessage(error, "Search failed."));
    }
  }, [scope]);

  useEffect(() => {
    void runTextSearch(query);
    // Invalidate foreground and exhaustive responses on navigation/unmount.
    // The shared in-flight request can still finish for another subscriber.
    return () => {
      textRequestGeneration.current += 1;
      textRequestController.current?.abort();
    };
  }, [query, runTextSearch]);

  useEffect(() => {
    if (!textIncomplete || textRetryAfterMs <= 0 || textRetries >= MAX_TEXT_SEARCH_RETRIES) return;
    const timeout = window.setTimeout(() => {
      void runTextSearch(query, true);
    }, textRetryAfterMs);
    return () => window.clearTimeout(timeout);
  }, [query, runTextSearch, textIncomplete, textRetryAfterMs, textRetries]);

  useEffect(() => {
    const normalized = query.trim();
    const startedAt = performance.now();
    setAiResults([]);
    setAiError(null);

    if (mode !== "ai") {
      setAiStatus("idle");
      return;
    }

    if (normalized.length < 2) {
      setAiStatus(normalized ? "ready" : "idle");
      return;
    }

    let cancelled = false;
    setAiStatus("loading");
    const controller = new AbortController();
    const cancelTimeout = abortAfter(controller, SEARCH_REQUEST_TIMEOUT_MS, "AI search timed out.");

    fetch(`/api/ai-search?scope=${encodeURIComponent(scope)}`, {
      body: JSON.stringify({ query: normalized, slugs }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
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
      .catch((error: unknown) => {
        if (cancelled) return;
        setAiResults([]);
        setAiStatus("error");
        setAiError(searchErrorMessage(error, "AI search failed."));
        recordSearchMetric({
          query: normalized,
          mode: "ai",
          durationMs: performance.now() - startedAt,
          resultCount: 0,
          status: "error",
        });
      })
      .finally(cancelTimeout);

    return () => {
      cancelled = true;
      cancelTimeout();
      controller.abort();
    };
    // Slugs come from the slower text-search path. AI mode should begin
    // immediately and not refetch when those candidates arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query, scope]);

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
          <SearchModeToggle mode={mode} onModeChange={setMode} />
        ) : null}
        <section aria-label="Search results" data-test-id="search-results">
          {mode === "ai" ? (
            <AISearch
              error={aiError}
              query={query}
              results={aiResults}
              status={aiStatus}
            />
          ) : (
            <TextSearch
              error={textError}
              // After the last retry, keep the indexed results without
              // promising more.
              incomplete={textIncomplete && textRetries < MAX_TEXT_SEARCH_RETRIES}
              key={query}
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
