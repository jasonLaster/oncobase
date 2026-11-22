"use client";

import {
  DefaultToolCallBlock,
  getChatToolInfo,
} from "@oncobase/chat/components/tool-call-core";
import { useChatRuntime } from "@oncobase/chat/runtime";
import type {
  ChatSourceExtractor,
  ChatToolCallRendererProps,
} from "@oncobase/chat/types";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  normalizeWikiEditProposal,
  useWikiEditReview,
  type WikiEditProposalState,
} from "./wiki-edit-review-context.tsx";

function hrefForPage(value: string | undefined, fallback?: string) {
  const raw = value ?? fallback;
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function WikiLink({
  children,
  className,
  href,
  title,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  title?: string;
}) {
  const { LinkComponent } = useChatRuntime();
  if (href.startsWith("/") && LinkComponent) {
    return (
      <LinkComponent className={className} href={href} title={title}>
        {children}
      </LinkComponent>
    );
  }
  return (
    <a className={className} href={href} title={title}>
      {children}
    </a>
  );
}

const FolderIcon = memo(function FolderIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="shrink-0 opacity-40"
      aria-hidden="true"
    >
      <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
    </svg>
  );
});

const SearchIcon = memo(function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="shrink-0 opacity-40"
      aria-hidden="true"
    >
      <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
    </svg>
  );
});

const DisclosureIcon = memo(function DisclosureIcon({
  expanded,
}: {
  expanded: boolean;
}) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`shrink-0 opacity-30 transition-transform ${expanded ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
});

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--text-muted)] border-t-transparent motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

const ReadPageBadge = memo(function ReadPageBadge({
  input,
  output,
  done,
}: {
  input: Record<string, unknown>;
  output: unknown;
  done: boolean;
}) {
  const slug = (input?.slug as string) || "";
  const result = output as {
    title?: string;
    slug?: string;
    href?: string;
    error?: string;
  } | null;
  const title = result?.title || slug.split("/").pop() || slug;
  const hasError = Boolean(result?.error);
  const href = hrefForPage(result?.href, result?.slug ?? slug);

  const content = (
    <>
      {!done ? <Spinner /> : <FolderIcon />}
      <span className="min-w-0 max-w-full truncate">
        {done ? `Read ${title}` : `Reading ${slug}...`}
      </span>
    </>
  );
  const className = `inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs transition-colors ${
    done && !hasError
      ? "text-[var(--text-muted)] hover:text-[var(--brand)]"
      : done && hasError
        ? "text-red-500"
        : "text-[var(--text-muted)]"
  }`;

  if (hasError) {
    return (
      <span className={className} title={result?.error}>
        {content}
      </span>
    );
  }

  return (
    <WikiLink href={href} className={className} title={title}>
      {content}
    </WikiLink>
  );
});

const SearchResultsBlock = memo(function SearchResultsBlock({
  output,
  done,
  query,
}: {
  output: unknown;
  done: boolean;
  query: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const results = (Array.isArray(output) ? output : []) as Array<{
    slug?: string;
    title?: string;
    href?: string;
  }>;

  if (!query && results.length === 0) return null;

  return (
    <div className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => done && setExpanded(!expanded)}
        aria-expanded={done && results.length > 0 ? expanded : undefined}
        className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-xs transition-colors ${
          done
            ? "text-[var(--text-muted)] hover:text-[var(--foreground)]"
            : "text-[var(--text-muted)]"
        }`}
      >
        {!done ? <Spinner /> : <SearchIcon />}
        <span className="min-w-0 truncate">
          {!done
            ? query
              ? `Searching "${query}"...`
              : "Searching..."
            : `Searched "${query}" - ${results.length} result${results.length === 1 ? "" : "s"}`}
        </span>
        {done && results.length > 0 ? <DisclosureIcon expanded={expanded} /> : null}
      </button>
      {expanded && results.length > 0 ? (
        <div className="mt-0.5 ml-4 min-w-0 max-w-[calc(100%-1rem)] space-y-0 border-l border-[var(--sidebar-border)] pl-2">
          {results.map((result, index) => (
            <WikiLink
              key={`${result.slug ?? result.href ?? index}`}
              href={hrefForPage(result.href, result.slug)}
              className="flex min-w-0 max-w-full items-center gap-1.5 py-0.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--brand)]"
              title={result.title ?? result.slug}
            >
              <FolderIcon />
              <span className="min-w-0 truncate">
                {result.title || result.slug}
              </span>
            </WikiLink>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function DocumentIcon() {
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
      className="shrink-0 opacity-80"
      aria-hidden="true"
    >
      <path d="M4 2.5h5.2L12.5 5.8V13a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8V3.3a.8.8 0 0 1 .8-.8Z" />
      <path d="M9 2.5V6h3.5M5.5 8.5h5M5.5 10.8h3.5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-80 transition-transform group-hover:translate-x-0.5"
      aria-hidden="true"
    >
      <path d="M3.5 8h9M8.8 4.2 12.5 8l-3.7 3.8" />
    </svg>
  );
}

const WikiEditProposalCard = memo(function WikiEditProposalCard({
  input,
  output,
  done,
}: {
  input: Record<string, unknown>;
  output: unknown;
  done: boolean;
}) {
  const review = useWikiEditReview();
  const initialRaw = (output && typeof output === "object" ? output : null) as
    | (Record<string, unknown> & { ok?: boolean; error?: string })
    | null;

  const fallbackSlug = useMemo(() => {
    if (typeof input.slug === "string" && input.slug) return input.slug;
    if (Array.isArray(input.pages) && input.pages.length > 0) {
      const first = input.pages[0] as { slug?: unknown } | undefined;
      if (typeof first?.slug === "string") return first.slug;
    }
    return "";
  }, [input]);

  const initialProposal = useMemo<WikiEditProposalState | null>(
    () =>
      normalizeWikiEditProposal(
        initialRaw as Parameters<typeof normalizeWikiEditProposal>[0],
        undefined,
        fallbackSlug,
      ),
    [fallbackSlug, initialRaw],
  );
  const proposalId = initialProposal?.proposalId ?? null;

  const liveFromContext = proposalId ? review?.getProposal(proposalId) : undefined;
  const proposal = liveFromContext ?? initialProposal;

  // Track whether this card started in the streaming (!done) state so only
  // freshly streamed proposals auto-open the desktop right panel.
  const startedStreamingRef = useRef(!done);
  const autoOpenedRef = useRef(false);

  const seedProposal = review?.seedProposal;
  const refreshProposal = review?.refreshProposal;
  const openProposal = review?.openProposal;

  useEffect(() => {
    if (!initialProposal || !proposalId || !seedProposal || !refreshProposal) return;
    seedProposal(initialProposal);
    void refreshProposal(proposalId);
  }, [initialProposal, proposalId, refreshProposal, seedProposal]);

  useEffect(() => {
    if (
      !done ||
      !startedStreamingRef.current ||
      autoOpenedRef.current ||
      !proposalId ||
      !initialProposal ||
      !openProposal
    ) {
      return;
    }
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      autoOpenedRef.current = true;
      openProposal(proposalId, initialProposal);
    }
  }, [done, initialProposal, openProposal, proposalId]);

  if (!done) {
    const pageCount = Array.isArray(input.pages) ? input.pages.length : 1;
    const label =
      pageCount > 1
        ? `Preparing wiki edits (${pageCount} pages)…`
        : `Preparing wiki edit for ${fallbackSlug || "page"}…`;
    return (
      <div className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <Spinner />
        <span className="min-w-0 truncate">{label}</span>
      </div>
    );
  }

  if (initialRaw?.ok === false || (!proposal && initialRaw?.error)) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        data-test-id="wiki-edit-proposal-error"
      >
        <span className="font-medium">Could not propose edit: </span>
        <span>{String(initialRaw?.error ?? "Validation failed.")}</span>
      </div>
    );
  }

  if (!proposal) {
    return <DefaultToolCallBlock toolName="propose_wiki_edit" state="output-available" />;
  }

  const fileCount = proposal.files.length;
  const isOpen = review?.activeProposalId === proposal.proposalId;
  const hasPublicFile = proposal.files.some((file) => !file.sensitive);
  const allSensitive = proposal.files.every((file) => file.sensitive);

  const statusBadge = (() => {
    switch (proposal.status) {
      case "published":
        return "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300";
      case "rejected":
      case "expired":
        return "border-[var(--sidebar-border)] bg-[var(--accent-light)] text-[var(--text-muted)]";
      case "failed":
        return "border-red-300/70 bg-red-500/10 text-red-700 dark:border-red-800 dark:text-red-300";
      case "committed_pending_publish":
      case "executing":
        return "border-amber-300/70 bg-amber-500/10 text-amber-800 dark:border-amber-800 dark:text-amber-300";
      default:
        return "border-[var(--brand)]/40 bg-[var(--brand)]/10 text-[var(--brand)]";
    }
  })();

  const statusLabel = (() => {
    switch (proposal.status) {
      case "pending":
        return "Awaiting approval";
      case "executing":
        return "Publishing…";
      case "committed_pending_publish":
        return "Publish pending";
      case "published":
        return "Published";
      case "rejected":
        return "Rejected";
      case "expired":
        return "Expired";
      case "failed":
        return "Failed";
    }
  })();

  const buttonLabel =
    fileCount > 1 ? `Review ${fileCount} wiki edits` : "Review wiki edit";

  return (
    <section
      aria-label={
        fileCount > 1
          ? `Proposed wiki edits (${fileCount} files)`
          : `Proposed wiki edit for ${proposal.title || proposal.slug}`
      }
      className="my-2 inline-flex w-full max-w-md flex-col gap-2 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/60 p-3 text-xs"
      data-test-id="wiki-edit-proposal-card"
      data-proposal-id={proposal.proposalId}
      data-proposal-status={proposal.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-[var(--foreground)]">
            {fileCount > 1
              ? `${fileCount} wiki pages`
              : proposal.title || proposal.slug}
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              allSensitive
                ? "border-amber-300/70 bg-amber-500/10 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                : "border-[var(--sidebar-border)] text-[var(--text-muted)]"
            }`}
          >
            {allSensitive ? "Sensitive" : hasPublicFile && proposal.files.some((f) => f.sensitive) ? "Mixed" : "Public"}
          </span>
          {proposal.stats ? (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{proposal.stats.additions}
              </span>
              {proposal.stats.deletions > 0 ? (
                <>
                  {" "}
                  <span className="text-red-600 dark:text-red-400">
                    -{proposal.stats.deletions}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge}`}>
          {statusLabel}
        </span>
      </div>

      {proposal.summary ? (
        <p className="line-clamp-2 text-[var(--text-muted)]">{proposal.summary}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => review?.openProposal(proposal.proposalId, proposal)}
          disabled={!review}
          className={`group inline-flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            isOpen
              ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--foreground)]"
              : "border-[var(--brand)]/45 bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--brand)] hover:bg-[var(--brand)]/10"
          }`}
          data-test-id="wiki-edit-review-open"
        >
          <span className="inline-flex items-center gap-2">
            <DocumentIcon />
            <span>{buttonLabel}</span>
          </span>
          <ArrowRightIcon />
        </button>

        {proposal.commitUrl ? (
          <a
            href={proposal.commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-[var(--brand)] hover:underline"
          >
            Commit {proposal.commitSha?.slice(0, 7)} ↗
          </a>
        ) : null}
      </div>
    </section>
  );
});

export function WikiChatToolRenderer({
  toolName,
  state,
  input,
  output,
  done,
}: ChatToolCallRendererProps) {
  const inputObj = (input || {}) as Record<string, unknown>;

  if (toolName === "read_page") {
    return <ReadPageBadge input={inputObj} output={output} done={done} />;
  }

  if (toolName === "search_wiki") {
    return (
      <SearchResultsBlock
        output={output}
        done={done}
        query={(inputObj.query as string) || ""}
      />
    );
  }

  if (toolName === "propose_wiki_edit") {
    return <WikiEditProposalCard input={inputObj} output={output} done={done} />;
  }

  return <DefaultToolCallBlock toolName={toolName} state={state} />;
}

export const extractWikiChatSources: ChatSourceExtractor = (parts) => {
  const seen = new Set<string>();
  const sources: ReturnType<ChatSourceExtractor> = [];

  for (const part of parts) {
    const info = getChatToolInfo(part as Record<string, unknown>);
    if (!info || info.state !== "output-available") continue;

    if (
      info.toolName === "read_page" &&
      info.output &&
      typeof info.output === "object"
    ) {
      const output = info.output as {
        slug?: string;
        title?: string;
        href?: string;
        error?: string;
      };
      const href = hrefForPage(output.href, output.slug);
      if (
        (output.slug || output.href) &&
        output.title &&
        !output.error &&
        !seen.has(href)
      ) {
        seen.add(href);
        sources.push({
          id: href,
          title: output.title,
          href,
        });
      }
    }

    if (info.toolName === "search_wiki" && Array.isArray(info.output)) {
      for (const item of info.output as Array<{
        slug?: string;
        title?: string;
        href?: string;
      }>) {
        const href = hrefForPage(item.href, item.slug);
        if ((item.slug || item.href) && item.title && !seen.has(href)) {
          seen.add(href);
          sources.push({
            id: href,
            title: item.title,
            href,
          });
        }
      }
    }
  }

  return sources;
};
