"use client";

import { useChatRuntime } from "@oncobase/chat/runtime";
import { safeSessionStorage } from "@oncobase/safe-storage";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  useWikiEditReview,
  type WikiEditProposalFile,
  type WikiEditProposalStatus,
} from "./wiki-edit-review-context.tsx";
import {
  buildWikiEditFileTree,
  parseUnifiedDiffRows,
  type WikiEditTreeNode,
} from "./wiki-edit-tree.ts";

const TAB_STORAGE_KEY = "oncobase:wiki-edit-review-tab";
type ReviewTab = "raw" | "preview";

function readStoredTab(): ReviewTab {
  const stored = safeSessionStorage.getItem(TAB_STORAGE_KEY);
  return stored === "raw" ? "raw" : "preview";
}

function statusText(status: WikiEditProposalStatus, fileCount: number): string {
  switch (status) {
    case "pending":
      return fileCount > 1 ? `Awaiting approval · ${fileCount} files` : "Awaiting approval";
    case "executing":
      return fileCount > 1 ? `Publishing ${fileCount} files…` : "Publishing…";
    case "committed_pending_publish":
      return "Committed · publish pending";
    case "published":
      return "Published";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "failed":
      return "Failed";
  }
}

function statusDotClass(status: WikiEditProposalStatus): string {
  switch (status) {
    case "published":
      return "bg-emerald-500";
    case "rejected":
    case "expired":
      return "bg-[var(--text-muted)]/60";
    case "failed":
      return "bg-red-500";
    case "executing":
    case "committed_pending_publish":
      return "bg-amber-500";
    default:
      return "bg-[var(--brand)]";
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 opacity-60 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function FolderSvg() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden="true"
    >
      <path d="M1.75 4.25A1.25 1.25 0 0 1 3 3h3.2l1.3 1.5H13A1.25 1.25 0 0 1 14.25 5.75v6A1.25 1.25 0 0 1 13 13H3a1.25 1.25 0 0 1-1.25-1.25v-7.5Z" />
    </svg>
  );
}

function FileBadgeIcon({ operation }: { operation: "edit" | "create" }) {
  const isCreate = operation === "create";
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${
        isCreate
          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
          : "bg-[var(--brand)]/20 text-[var(--brand)]"
      }`}
      title={isCreate ? "New page" : "Modified page"}
      aria-hidden="true"
    >
      {isCreate ? "A" : "M"}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

const TreeBranch = memo(function TreeBranch({
  nodes,
  depth,
  selectedSlug,
  collapsed,
  onToggleFolder,
  onSelectFile,
  onTreeKeyDown,
}: {
  nodes: Array<WikiEditTreeNode<WikiEditProposalFile>>;
  depth: number;
  selectedSlug: string | null;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (slug: string) => void;
  onTreeKeyDown?: (event: KeyboardEvent<HTMLUListElement>) => void;
}) {
  return (
    <ul
      className="space-y-0.5"
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? "Changed files" : undefined}
      onKeyDown={depth === 0 ? onTreeKeyDown : undefined}
    >
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const isOpen = !collapsed.has(node.path);
          return (
            <li key={node.path} role="treeitem" aria-expanded={isOpen} aria-selected={false}>
              <button
                type="button"
                onClick={() => onToggleFolder(node.path)}
                style={{ paddingLeft: `${depth * 10 + 6}px` }}
                className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
              >
                <ChevronIcon open={isOpen} />
                <FolderSvg />
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              {isOpen ? (
                <TreeBranch
                  nodes={node.children}
                  depth={depth + 1}
                  selectedSlug={selectedSlug}
                  collapsed={collapsed}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                />
              ) : null}
            </li>
          );
        }

        const isActive = node.file.slug === selectedSlug;
        return (
          <li key={node.file.slug} role="treeitem" aria-selected={isActive}>
            <button
              type="button"
              onClick={() => onSelectFile(node.file.slug)}
              aria-current={isActive ? "true" : undefined}
              style={{ paddingLeft: `${depth * 10 + 8}px` }}
              className={`flex w-full items-center justify-between gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors ${
                isActive
                  ? "bg-[var(--brand)]/18 text-[var(--foreground)] ring-1 ring-[var(--brand)]/40 font-medium"
                  : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
              }`}
              data-test-id="wiki-edit-tree-file"
              data-file-slug={node.file.slug}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <FileBadgeIcon operation={node.file.operation} />
                <span className="min-w-0 truncate">{node.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                {node.file.stats.additions > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{node.file.stats.additions}
                  </span>
                ) : null}
                {node.file.stats.deletions > 0 ? (
                  <span className="text-red-600 dark:text-red-400">
                    -{node.file.stats.deletions}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
});

const RawDiffPane = memo(function RawDiffPane({ file }: { file: WikiEditProposalFile }) {
  const rows = useMemo(() => parseUnifiedDiffRows(file.redactedDiff), [file.redactedDiff]);

  return (
    <div className="space-y-3" data-test-id="wiki-edit-raw-view">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-[var(--text-muted)]">Markdown changes</span>
        <span className="flex items-center gap-2 font-mono text-xs font-medium">
          {file.stats.additions > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400">+{file.stats.additions}</span>
          ) : null}
          {file.stats.deletions > 0 ? (
            <span className="text-red-600 dark:text-red-400">-{file.stats.deletions}</span>
          ) : null}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[var(--text-muted)]">No textual diff lines.</p>
        ) : (
          <table className="w-full border-collapse font-mono text-[12px] leading-5">
            <tbody>
              {rows.map((row, idx) => {
                if (row.kind === "hunk") {
                  return (
                    <tr
                      key={idx}
                      className="border-y border-[var(--sidebar-border)]/70 bg-[var(--accent-light)]/50 text-[11px] text-[var(--text-muted)] first:border-t-0"
                    >
                      <td colSpan={3} className="px-3 py-1 select-none">
                        {row.text}
                      </td>
                    </tr>
                  );
                }

                const lineNum = row.kind === "del" ? row.oldLine : row.newLine;
                const rowClass =
                  row.kind === "add"
                    ? "bg-emerald-500/12 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-100"
                    : row.kind === "del"
                      ? "bg-red-500/12 text-red-950 dark:bg-red-500/15 dark:text-red-100"
                      : "text-[var(--foreground)]/90";
                const marker = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
                const markerClass =
                  row.kind === "add"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : row.kind === "del"
                      ? "text-red-600 dark:text-red-400"
                      : "text-[var(--text-muted)]/40";

                return (
                  <tr key={idx} className={rowClass}>
                    <td className="w-10 select-none border-r border-[var(--sidebar-border)]/50 px-2 py-0.5 text-right align-top text-[11px] text-[var(--text-muted)]/70">
                      {lineNum ?? ""}
                    </td>
                    <td className={`w-6 select-none py-0.5 pl-2.5 pr-1.5 align-top font-semibold ${markerClass}`}>
                      {marker}
                    </td>
                    <td className="whitespace-pre-wrap break-words py-0.5 pr-3">{row.text || " "}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

export function WikiEditReviewPanel() {
  const review = useWikiEditReview();
  const { LinkComponent, MarkdownRenderer } = useChatRuntime();
  const [activeTab, setActiveTab] = useState<ReviewTab>(readStoredTab);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  const proposal = review?.activeProposal ?? null;
  const selectedSlug = review?.selectedFileSlug ?? null;
  const selectedFile = useMemo(
    () =>
      proposal?.files.find((file) => file.slug === selectedSlug) ??
      proposal?.files[0] ??
      null,
    [proposal, selectedSlug],
  );

  const tree = useMemo(
    () => (proposal ? buildWikiEditFileTree(proposal.files) : []),
    [proposal],
  );

  const handleSetTab = useCallback((next: ReviewTab) => {
    setActiveTab(next);
    safeSessionStorage.setItem(TAB_STORAGE_KEY, next);
  }, []);

  const handleToggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Close panel on Escape.
  useEffect(() => {
    if (!proposal || !review) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        review.closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [proposal, review]);

  // Refresh active proposal state when window regains focus.
  useEffect(() => {
    if (!proposal || !review) return;
    const onFocus = () => {
      void review.refreshProposal(proposal.proposalId, { includePreview: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [proposal, review]);

  const scrollToChangedHeading = useCallback(() => {
    const container = previewContainerRef.current;
    const targetHeading = selectedFile?.firstChangedHeading?.trim().toLowerCase();
    if (!container || !targetHeading) return;
    const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    const match = headings.find(
      (el) => (el.textContent ?? "").trim().toLowerCase() === targetHeading,
    );
    if (match) {
      match.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedFile?.firstChangedHeading]);

  // Auto-scroll to the first changed heading when Preview renders for a file.
  useEffect(() => {
    if (activeTab !== "preview" || !selectedFile?.redactedPreview || !selectedFile.firstChangedHeading) {
      return;
    }
    const timer = window.setTimeout(scrollToChangedHeading, 120);
    return () => window.clearTimeout(timer);
  }, [activeTab, scrollToChangedHeading, selectedFile?.firstChangedHeading, selectedFile?.redactedPreview, selectedFile?.slug]);

  if (!review || !proposal || !selectedFile) return null;

  const fileCount = proposal.files.length;
  const hasPublicFile = proposal.files.some((file) => !file.sensitive);
  const showCrossVisibilityWarning = Boolean(proposal.readSensitiveInSession && hasPublicFile);
  const canApprove = proposal.status === "pending";
  const canRetry =
    proposal.status === "committed_pending_publish" || proposal.status === "failed";
  const isBusy = review.submittingAction !== null || proposal.status === "executing";
  const breadcrumbParts = (selectedFile.filePath || `${selectedFile.slug}.md`)
    .replace(/^\/+/, "")
    .split("/");

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const idx = proposal.files.findIndex((file) => file.slug === selectedFile.slug);
    if (idx === -1) return;
    event.preventDefault();
    const nextIdx =
      event.key === "ArrowDown"
        ? (idx + 1) % proposal.files.length
        : (idx - 1 + proposal.files.length) % proposal.files.length;
    review.selectFile(proposal.files[nextIdx]!.slug);
  };

  const liveHref = selectedFile.slug.startsWith("/") ? selectedFile.slug : `/${selectedFile.slug}`;

  return (
    <aside
      aria-label={fileCount > 1 ? `Review wiki edits (${fileCount} files)` : "Review wiki edit"}
      className="wiki-edit-review-panel flex h-full min-h-0 flex-col border-l border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--foreground)]"
      data-test-id="wiki-edit-review-panel"
      data-proposal-id={proposal.proposalId}
      data-proposal-status={proposal.status}
    >
      {/* Top header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--sidebar-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-[var(--foreground)]">
            {fileCount > 1 ? `Review wiki edits` : "Review wiki edit"}
          </h2>
          {fileCount > 1 ? (
            <span className="rounded-full border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
              {fileCount} files
            </span>
          ) : null}
          {proposal.branch ? (
            <span className="hidden rounded border border-[var(--sidebar-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline-block">
              {proposal.branch}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={review.closePanel}
          aria-label="Close review panel"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
          data-test-id="wiki-edit-review-close"
        >
          <CloseIcon />
        </button>
      </header>

      {/* Mobile / narrow file selector */}
      {fileCount > 1 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--sidebar-border)] px-4 py-2 lg:hidden">
          <label htmlFor="wiki-edit-mobile-file" className="text-xs font-medium text-[var(--text-muted)]">
            File
          </label>
          <select
            id="wiki-edit-mobile-file"
            value={selectedFile.slug}
            onChange={(event) => review.selectFile(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-2 py-1 text-xs text-[var(--foreground)]"
          >
            {proposal.files.map((file) => (
              <option key={file.slug} value={file.slug}>
                {file.operation === "create" ? "[New] " : ""}
                {file.filePath} (+{file.stats.additions} -{file.stats.deletions})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Main split body: Changed files tree + Raw/Preview pane */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Changed files sidebar (desktop) */}
        <div className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/50 lg:flex">
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <span className="text-xs font-semibold text-[var(--foreground)]">Changed files</span>
            {proposal.stats ? (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{proposal.stats.additions}
                </span>{" "}
                {proposal.stats.deletions > 0 ? (
                  <span className="text-red-600 dark:text-red-400">
                    -{proposal.stats.deletions}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <TreeBranch
              nodes={tree}
              depth={0}
              selectedSlug={selectedFile.slug}
              collapsed={collapsedFolders}
              onToggleFolder={handleToggleFolder}
              onSelectFile={review.selectFile}
              onTreeKeyDown={handleTreeKeyDown}
            />
          </div>
        </div>

        {/* File detail column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Breadcrumb + Raw / Preview tab strip */}
          <div className="shrink-0 border-b border-[var(--sidebar-border)] px-5 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-xs text-[var(--text-muted)]">
                {breadcrumbParts.map((part, idx) => (
                  <span key={`${part}-${idx}`} className="inline-flex items-center gap-1">
                    {idx > 0 ? <span className="opacity-40">/</span> : null}
                    <span
                      className={
                        idx === breadcrumbParts.length - 1
                          ? "font-medium text-[var(--foreground)]"
                          : undefined
                      }
                    >
                      {part}
                    </span>
                  </span>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {selectedFile.operation === "create" ? (
                  <span className="rounded border border-emerald-400/50 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    New page
                  </span>
                ) : null}
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    selectedFile.sensitive
                      ? "border-amber-400/50 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                      : "border-[var(--sidebar-border)] text-[var(--text-muted)]"
                  }`}
                >
                  {selectedFile.sensitive ? "Sensitive" : "Public"}
                </span>
                {(selectedFile.operation === "edit" || proposal.status === "published") &&
                LinkComponent ? (
                  <LinkComponent
                    href={liveHref}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--brand)] hover:underline"
                    title="Open live page"
                  >
                    Live page ↗
                  </LinkComponent>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-5" role="tablist" aria-label="Diff view mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "raw"}
                  onClick={() => handleSetTab("raw")}
                  className={`relative pb-2 text-xs font-medium transition-colors ${
                    activeTab === "raw"
                      ? "text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--brand)]"
                      : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  }`}
                  data-test-id="wiki-edit-tab-raw"
                >
                  Raw
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "preview"}
                  onClick={() => handleSetTab("preview")}
                  className={`relative pb-2 text-xs font-medium transition-colors ${
                    activeTab === "preview"
                      ? "text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--brand)]"
                      : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                  }`}
                  data-test-id="wiki-edit-tab-preview"
                >
                  Preview
                </button>
              </div>
              {activeTab === "preview" && selectedFile.firstChangedHeading ? (
                <button
                  type="button"
                  onClick={scrollToChangedHeading}
                  className="mb-1.5 rounded-full border border-[var(--sidebar-border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--brand)]/50 hover:text-[var(--brand)]"
                >
                  Jump to change
                </button>
              ) : null}
            </div>
          </div>

          {/* Scrollable file content */}
          <div
            ref={previewContainerRef}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          >
            {showCrossVisibilityWarning ? (
              <div
                className="mb-4 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
                data-test-id="wiki-edit-cross-visibility-warning"
              >
                <strong>Cross-visibility check:</strong> Sensitive pages were read earlier in this
                chat, and this changeset writes to a <strong>public</strong> page. Verify no
                sensitive details are included before approving.
              </div>
            ) : null}

            {proposal.summary ? (
              <p className="mb-4 text-xs text-[var(--text-muted)]">
                <span className="font-medium text-[var(--foreground)]/80">
                  AI summary (untrusted):{" "}
                </span>
                {proposal.summary}
              </p>
            ) : null}

            {activeTab === "raw" ? (
              <RawDiffPane file={selectedFile} />
            ) : (
              <div data-test-id="wiki-edit-preview-view">
                {selectedFile.redactedPreview ? (
                  MarkdownRenderer ? (
                    <div className="wiki-edit-preview-prose prose-sm max-w-none">
                      <MarkdownRenderer content={selectedFile.redactedPreview} disableAnchors />
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-xs text-[var(--foreground)]">
                      {selectedFile.redactedPreview}
                    </pre>
                  )
                ) : review.loadingPreview ? (
                  <div className="space-y-3 py-4">
                    <div className="h-6 w-1/2 animate-pulse rounded bg-[var(--accent-light)]" />
                    <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--accent-light)]" />
                    <div className="h-24 w-full animate-pulse rounded bg-[var(--accent-light)]" />
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-4 text-xs text-[var(--text-muted)]">
                    <p>Full rendered preview is unavailable for this proposal state.</p>
                    <button
                      type="button"
                      onClick={() => handleSetTab("raw")}
                      className="mt-2 font-medium text-[var(--brand)] hover:underline"
                    >
                      View Markdown diff instead →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error banner above sticky footer */}
      {review.actionError || proposal.error ? (
        <div
          className="shrink-0 border-t border-red-400/40 bg-red-500/10 px-4 py-2 text-xs text-red-700 dark:text-red-300"
          role="alert"
        >
          {review.actionError || proposal.error}
        </div>
      ) : null}

      {/* Sticky bottom action bar */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--sidebar-border)] bg-[var(--background)] px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDotClass(proposal.status)}`}
            aria-hidden="true"
          />
          <span className="font-medium text-[var(--foreground)]/90">
            {statusText(proposal.status, fileCount)}
          </span>
          {proposal.commitSha ? (
            proposal.commitUrl ? (
              <a
                href={proposal.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-[var(--brand)] hover:underline"
              >
                Commit {proposal.commitSha.slice(0, 7)} ↗
              </a>
            ) : (
              <span className="font-mono text-[11px]">
                Commit {proposal.commitSha.slice(0, 7)}
              </span>
            )
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canApprove ? (
            <>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void review.submitAction(proposal.proposalId, "reject")}
                className="rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent-light)] disabled:opacity-50"
                data-test-id="wiki-edit-reject"
              >
                {review.submittingAction === "reject" ? "Rejecting…" : "Reject"}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void review.submitAction(proposal.proposalId, "approve")}
                className="rounded-md bg-[var(--brand)] px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                data-test-id="wiki-edit-approve"
              >
                {review.submittingAction === "approve"
                  ? "Publishing…"
                  : fileCount > 1
                    ? `Approve & Publish (${fileCount})`
                    : "Approve & Publish"}
              </button>
            </>
          ) : null}
          {canRetry ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void review.submitAction(proposal.proposalId, "approve")}
              className="rounded-md bg-[var(--brand)] px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              data-test-id="wiki-edit-retry"
            >
              {review.submittingAction === "approve" ? "Retrying…" : "Retry Publish"}
            </button>
          ) : null}
        </div>
      </footer>
    </aside>
  );
}
