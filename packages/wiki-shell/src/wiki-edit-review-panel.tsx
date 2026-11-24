"use client";

import { useChatRuntime } from "@oncobase/chat/runtime";
import { safeSessionStorage } from "@oncobase/safe-storage";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@oncobase/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@oncobase/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@oncobase/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import {
  Tree,
  TreeGroup,
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  type TreeItemData,
} from "@oncobase/ui/tree";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useWikiEditReview,
  type WikiEditProposalFile,
  type WikiEditProposalStatus,
} from "./wiki-edit-review-context.tsx";
import { buildWikiEditTree, parseUnifiedDiffRows, wikiEditFilePath } from "./wiki-edit-tree.ts";

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

function ChevronIcon() {
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
      className="shrink-0 opacity-60"
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

const TOOLTIP_CLASS =
  "rounded-md bg-[var(--foreground)] px-2 py-1 text-[11px] text-[var(--background)] shadow-lg";

function FileBadgeIcon({ operation }: { operation: "edit" | "create" }) {
  const isCreate = operation === "create";
  return (
    <Tooltip delay={400}>
      <TooltipTrigger
        render={
          <span
            aria-hidden="true"
            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${
              isCreate
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : "bg-[var(--brand)]/20 text-[var(--brand)]"
            }`}
          />
        }
      >
        {isCreate ? "A" : "M"}
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className={TOOLTIP_CLASS}>
        {isCreate ? "New page" : "Modified page"}
      </TooltipContent>
    </Tooltip>
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

const TREE_ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)] [:focus-visible>&]:outline-2 [:focus-visible>&]:outline-[var(--brand)]";

const NO_ITEMS: readonly TreeItemData[] = [];

const ChangedFileRows = memo(function ChangedFileRows({
  items,
  filesByPath,
}: {
  items: readonly TreeItemData[];
  filesByPath: ReadonlyMap<string, WikiEditProposalFile>;
}) {
  return items.map((item) => {
    const file = item.children ? undefined : filesByPath.get(item.value);
    if (!file) {
      return (
        <TreeItem key={item.value} value={item.value} label={item.label} className="outline-none">
          <TreeItemLabel
            className={`${TREE_ROW_CLASS} py-1`}
            style={{ paddingLeft: "calc((var(--tree-level) - 1) * 10px + 6px)" }}
          >
            <TreeItemIndicator className="inline-flex shrink-0 transition-transform data-[expanded]:rotate-90">
              <ChevronIcon />
            </TreeItemIndicator>
            <FolderSvg />
            <span className="min-w-0 truncate">{item.label}</span>
          </TreeItemLabel>
          <TreeGroup className="mt-0.5 space-y-0.5">
            <ChangedFileRows items={item.children ?? NO_ITEMS} filesByPath={filesByPath} />
          </TreeGroup>
        </TreeItem>
      );
    }

    return (
      <TreeItem
        key={item.value}
        value={item.value}
        label={item.label}
        className="outline-none"
        data-test-id="wiki-edit-tree-file"
        data-file-slug={file.slug}
      >
        <TreeItemLabel
          className={`${TREE_ROW_CLASS} justify-between py-1.5 data-[selected]:bg-[var(--brand)]/18 data-[selected]:font-medium data-[selected]:text-[var(--foreground)] data-[selected]:ring-1 data-[selected]:ring-[var(--brand)]/40`}
          style={{ paddingLeft: "calc((var(--tree-level) - 1) * 10px + 8px)" }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <FileBadgeIcon operation={file.operation} />
            <span className="min-w-0 truncate">{item.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
            {file.stats.additions > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                +{file.stats.additions}
              </span>
            ) : null}
            {file.stats.deletions > 0 ? (
              <span className="text-red-600 dark:text-red-400">-{file.stats.deletions}</span>
            ) : null}
          </span>
        </TreeItemLabel>
      </TreeItem>
    );
  });
});

const REVIEW_TAB_CLASS =
  "relative cursor-pointer pb-2 text-xs font-medium text-[var(--text-muted)] transition-colors outline-none hover:text-[var(--foreground)] focus-visible:text-[var(--foreground)] focus-visible:underline data-[selected]:text-[var(--foreground)] data-[selected]:after:absolute data-[selected]:after:inset-x-0 data-[selected]:after:bottom-0 data-[selected]:after:h-0.5 data-[selected]:after:rounded-full data-[selected]:after:bg-[var(--brand)]";

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

  const tree = useMemo(() => buildWikiEditTree(proposal?.files ?? []), [proposal]);

  const handleSetTab = useCallback((next: ReviewTab) => {
    setActiveTab(next);
    safeSessionStorage.setItem(TAB_STORAGE_KEY, next);
  }, []);

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
  const breadcrumbParts = wikiEditFilePath(selectedFile).split("/");

  const fileOptions = proposal.files.map((file) => ({
    value: file.slug,
    label: `${file.operation === "create" ? "[New] " : ""}${file.filePath} (+${file.stats.additions} -${file.stats.deletions})`,
  }));
  const liveHref = selectedFile.slug.startsWith("/") ? selectedFile.slug : `/${selectedFile.slug}`;

  return (
    <Dialog
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) review.closePanel();
      }}
    >
      <DialogContent
        inline
        initialFocus="none"
        className="wiki-edit-review-panel static m-0 flex h-full max-h-none min-h-0 w-full max-w-none flex-col border-0 border-l border-[var(--sidebar-border)] bg-[var(--background)] p-0 text-[var(--foreground)]"
        data-test-id="wiki-edit-review-panel"
        data-proposal-id={proposal.proposalId}
        data-proposal-status={proposal.status}
      >
        {/* Top header */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--sidebar-border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="m-0 truncate text-sm font-semibold text-[var(--foreground)]">
              {fileCount > 1 ? `Review wiki edits` : "Review wiki edit"}
            </DialogTitle>
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
          <DialogClose
            aria-label="Close review panel"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
            data-test-id="wiki-edit-review-close"
          >
            <CloseIcon />
          </DialogClose>
        </header>

        {/* Mobile / narrow file selector */}
        {fileCount > 1 ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--sidebar-border)] px-4 py-2 lg:hidden">
            <Select
              items={fileOptions}
              value={selectedFile.slug}
              onValueChange={(slug) => {
                if (typeof slug === "string") review.selectFile(slug);
              }}
            >
              <SelectLabel className="text-xs font-medium text-[var(--text-muted)]">File</SelectLabel>
              <SelectTrigger className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-2 py-1 text-left text-xs text-[var(--foreground)]">
                <SelectValue className="min-w-0 truncate" />
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </SelectTrigger>
              <SelectContent className="m-0 max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-[var(--sidebar-border)] bg-[var(--card)] p-1 text-xs text-[var(--foreground)] shadow-lg">
                {fileOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="cursor-pointer rounded px-2 py-1.5 data-[highlighted]:bg-[var(--accent-light)] data-[selected]:font-medium"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <Tree
                key={proposal.proposalId}
                aria-label="Changed files"
                items={tree.items}
                value={wikiEditFilePath(selectedFile)}
                onValueChange={(path, details) => {
                  const file = typeof path === "string" ? tree.filesByPath.get(path) : undefined;
                  if (!file) {
                    details.cancel();
                    return;
                  }
                  review.selectFile(file.slug);
                }}
                activation="automatic"
                defaultExpanded={tree.folderPaths}
                expandOnPress
                className="space-y-0.5"
              >
                <ChangedFileRows items={tree.items} filesByPath={tree.filesByPath} />
              </Tree>
            </div>
          </div>

          {/* File detail column */}
          <Tabs
            value={activeTab}
            onValueChange={(next) => {
              if (next === "raw" || next === "preview") handleSetTab(next);
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
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
                    >
                      Live page ↗
                    </LinkComponent>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <TabsList aria-label="Diff view mode" className="flex items-center gap-5">
                  <TabsTab value="raw" className={REVIEW_TAB_CLASS} data-test-id="wiki-edit-tab-raw">
                    Raw
                  </TabsTab>
                  <TabsTab
                    value="preview"
                    className={REVIEW_TAB_CLASS}
                    data-test-id="wiki-edit-tab-preview"
                  >
                    Preview
                  </TabsTab>
                </TabsList>
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

              <TabsPanel value="raw" className="outline-none">
                <RawDiffPane file={selectedFile} />
              </TabsPanel>
              <TabsPanel value="preview" className="outline-none" data-test-id="wiki-edit-preview-view">
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
              </TabsPanel>
            </div>
          </Tabs>
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
      </DialogContent>
    </Dialog>
  );
}
