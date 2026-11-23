"use client";

import {
  DefaultToolCallBlock,
  getChatToolInfo,
} from "@oncobase/chat/components/tool-call-core";
import { HintButton } from "@oncobase/chat/components/hint-button";
import { useChatRuntime } from "@oncobase/chat/runtime";
import type {
  ChatMessageActionProps,
  ChatSourceExtractor,
  ChatToolCallRendererProps,
} from "@oncobase/chat/types";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@oncobase/ui/collapsible";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
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
  const results = (Array.isArray(output) ? output : []) as Array<{
    slug?: string;
    title?: string;
    href?: string;
  }>;

  if (!query && results.length === 0) return null;

  const summary = (
    <>
      {!done ? <Spinner /> : <SearchIcon />}
      <span className="min-w-0 truncate">
        {!done
          ? query
            ? `Searching "${query}"...`
            : "Searching..."
          : `Searched "${query}" - ${results.length} result${results.length === 1 ? "" : "s"}`}
      </span>
    </>
  );

  if (!done || results.length === 0) {
    return (
      <div className="min-w-0 max-w-full">
        <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-xs text-[var(--text-muted)]">
          {summary}
        </span>
      </div>
    );
  }

  return (
    <Collapsible className="min-w-0 max-w-full">
      <CollapsibleTrigger className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]">
        {({ open }) => (
          <>
            {summary}
            <DisclosureIcon expanded={open} />
          </>
        )}
      </CollapsibleTrigger>
      <CollapsiblePanel className="mt-0.5 ml-4 min-w-0 max-w-[calc(100%-1rem)] space-y-0 border-l border-[var(--sidebar-border)] pl-2">
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
      </CollapsiblePanel>
    </Collapsible>
  );
});

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

  // The card is gone: the message's "Review updates" action opens the panel.
  // This stays as a quiet status line and keeps the seeding/auto-open effects.
  const fileCount = proposal.files.length;
  const statusLabel = (() => {
    switch (proposal.status) {
      case "pending":
        return "awaiting approval";
      case "executing":
        return "publishing…";
      case "committed_pending_publish":
        return "publish pending";
      case "published":
        return "published";
      case "rejected":
        return "rejected";
      case "expired":
        return "expired";
      case "failed":
        return "failed";
    }
  })();

  return (
    <div
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]"
      data-test-id="wiki-edit-proposal-status"
      data-proposal-id={proposal.proposalId}
      data-proposal-status={proposal.status}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d="M3 8.5l3 3 7-7" />
      </svg>
      <span className="min-w-0 truncate">
        Drafted wiki updates, {fileCount} {fileCount === 1 ? "page" : "pages"} · {statusLabel}
      </span>
      {proposal.commitUrl ? (
        <a
          href={proposal.commitUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-[var(--brand)] hover:underline"
        >
          {proposal.commitSha?.slice(0, 7)} ↗
        </a>
      ) : null}
    </div>
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

/**
 * Message-level "Review updates" action. Sits in the assistant message's
 * hover row next to Copy/Edit/Regenerate and opens the review panel for the
 * wiki edit proposal(s) the message produced. Stays visible while any
 * proposal is waiting on the reader, and reveals on hover once resolved.
 */
export function WikiChatMessageAction({ parts }: ChatMessageActionProps) {
  const review = useWikiEditReview();
  const proposals = useMemo(() => {
    const found: WikiEditProposalState[] = [];
    for (const part of parts) {
      const info = getChatToolInfo(part as Record<string, unknown>);
      if (!info || info.toolName !== "propose_wiki_edit") continue;
      if (info.state !== "output-available" || !info.output) continue;
      const input = (info.input || {}) as { slug?: unknown };
      const proposal = normalizeWikiEditProposal(
        info.output as Parameters<typeof normalizeWikiEditProposal>[0],
        undefined,
        typeof input.slug === "string" ? input.slug : undefined,
      );
      if (proposal) found.push(proposal);
    }
    return found;
  }, [parts]);

  if (!review || proposals.length === 0) return null;

  const live = proposals.map((p) => review.getProposal(p.proposalId) ?? p);
  const fileCount = live.reduce((n, p) => n + p.files.length, 0);
  const waiting = live.find((p) => p.status === "pending");
  const target = waiting ?? live[0]!;
  const isOpen = live.some((p) => p.proposalId === review.activeProposalId);

  return (
    <HintButton
      hint="Review wiki updates"
      onClick={() => review.openProposal(target.proposalId, target)}
      aria-label={`Review updates (${fileCount})`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        waiting
          ? "bg-[var(--brand)]/10 font-medium text-[var(--brand)] hover:bg-[var(--brand)]/15"
          : "text-[var(--text-muted)] opacity-100 hover:bg-[var(--accent-light)] hover:text-[var(--foreground)] sm:opacity-0 sm:group-hover/assistant:opacity-100 sm:focus-visible:opacity-100"
      } ${isOpen ? "ring-1 ring-[var(--brand)]/40" : ""}`}
      data-test-id="wiki-edit-message-action"
      data-proposal-status={target.status}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 2.5h7l3 3v8H3z" />
        <path d="M5.5 9l1.5 1.5L10.5 7" />
      </svg>
      <span>Review updates ({fileCount})</span>
    </HintButton>
  );
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
