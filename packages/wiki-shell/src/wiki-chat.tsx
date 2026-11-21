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
import { memo, useCallback, useEffect, useState, type ReactNode } from "react";

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

type WikiEditProposalState = {
  proposalId: string;
  slug: string;
  title?: string;
  filePath?: string;
  branch?: string;
  sensitive?: boolean;
  readSensitiveInSession?: boolean;
  summary?: string;
  redactedDiff?: string;
  stats?: { additions: number; deletions: number };
  status:
    | "pending"
    | "executing"
    | "committed_pending_publish"
    | "published"
    | "rejected"
    | "failed"
    | "expired";
  commitSha?: string;
  commitUrl?: string;
  publishedRevision?: number;
  error?: string;
};

const WikiEditProposalCard = memo(function WikiEditProposalCard({
  input,
  output,
  done,
}: {
  input: Record<string, unknown>;
  output: unknown;
  done: boolean;
}) {
  const { onWikiEdited } = useChatRuntime();
  const initial = (output && typeof output === "object" ? output : null) as
    | (Partial<WikiEditProposalState> & { ok?: boolean; error?: string })
    | null;
  const slug = initial?.slug || (typeof input.slug === "string" ? input.slug : "");
  const proposalId = initial?.proposalId;

  const initialProposal: WikiEditProposalState | null =
    proposalId && slug
      ? {
          proposalId,
          slug,
          title: initial?.title,
          filePath: initial?.filePath,
          branch: initial?.branch,
          sensitive: initial?.sensitive,
          readSensitiveInSession: initial?.readSensitiveInSession,
          summary: initial?.summary,
          redactedDiff: initial?.redactedDiff,
          stats: initial?.stats,
          status: initial?.status ?? "pending",
          commitSha: initial?.commitSha,
          commitUrl: initial?.commitUrl,
          publishedRevision: initial?.publishedRevision,
          error: initial?.error,
        }
      : null;

  const [liveProposal, setLiveProposal] = useState<WikiEditProposalState | null>(null);
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const proposal =
    liveProposal && liveProposal.proposalId === proposalId
      ? liveProposal
      : initialProposal;

  const fetchLatestProposal = useCallback(async (id: string) => {
    const response = await fetch(`/api/chat/wiki-edits?id=${encodeURIComponent(id)}`, {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      proposal?: Omit<WikiEditProposalState, "proposalId"> & { _id?: string };
    };
    return body.proposal
      ? { ...body.proposal, proposalId: body.proposal._id ?? id }
      : null;
  }, []);

  useEffect(() => {
    if (!proposalId) return;
    let cancelled = false;
    const load = () => {
      void fetchLatestProposal(proposalId)
        .then((next) => {
          if (!cancelled && next) setLiveProposal(next);
        })
        .catch(() => {
          // Best-effort refresh; keep last known proposal state visible.
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [fetchLatestProposal, proposalId]);

  const handleAction = useCallback(
    async (action: "approve" | "reject") => {
      if (!proposalId || submitting) return;
      setSubmitting(action);
      setActionError(null);
      try {
        const response = await fetch(`/api/chat/wiki-edits/${action}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          proposal?: Omit<WikiEditProposalState, "proposalId"> & { _id?: string };
          revision?: number;
          error?: string;
        };
        if (body.proposal) {
          setLiveProposal({
            ...body.proposal,
            proposalId: body.proposal._id ?? proposalId,
          });
        }
        if (!response.ok) {
          setActionError(body.error ?? `Could not ${action} edit (${response.status})`);
          const latest = await fetchLatestProposal(proposalId).catch(() => null);
          if (latest) setLiveProposal(latest);
          return;
        }
        if (action === "approve" && body.proposal?.status === "published") {
          onWikiEdited?.({ slug: body.proposal.slug, revision: body.revision });
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : `Failed to ${action} edit`);
      } finally {
        setSubmitting(null);
      }
    },
    [fetchLatestProposal, onWikiEdited, proposalId, submitting],
  );

  if (!done) {
    return (
      <div className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <Spinner />
        <span className="min-w-0 truncate">Preparing wiki edit for {slug || "page"}...</span>
      </div>
    );
  }

  if (initial?.ok === false || (!proposal && initial?.error)) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        data-test-id="wiki-edit-proposal-error"
      >
        <span className="font-medium">Could not propose edit: </span>
        <span>{initial?.error ?? "Validation failed."}</span>
      </div>
    );
  }

  if (!proposal) {
    return <DefaultToolCallBlock toolName="propose_wiki_edit" state="output-available" />;
  }

  const canApprove = proposal.status === "pending";
  const canRetry =
    proposal.status === "committed_pending_publish" || proposal.status === "failed";
  const isBusy = submitting !== null || proposal.status === "executing";
  const diffLines = (proposal.redactedDiff ?? "").split("\n");

  const statusBadge = (() => {
    switch (proposal.status) {
      case "published":
        return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
      case "rejected":
      case "expired":
        return "border-[var(--sidebar-border)] bg-[var(--accent-light)] text-[var(--text-muted)]";
      case "failed":
        return "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
      case "committed_pending_publish":
      case "executing":
        return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
      default:
        return "border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--foreground)]";
    }
  })();

  const statusLabel = (() => {
    switch (proposal.status) {
      case "pending":
        return "Awaiting approval";
      case "executing":
        return "Publishing…";
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
  })();

  return (
    <section
      aria-label={`Proposed wiki edit for ${proposal.title || proposal.slug}`}
      className="my-2 min-w-0 max-w-full rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)] p-3 text-xs"
      data-test-id="wiki-edit-proposal-card"
      data-proposal-id={proposal.proposalId}
      data-proposal-status={proposal.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <WikiLink
            href={hrefForPage(proposal.slug)}
            className="font-medium text-[var(--brand)] hover:underline truncate"
            title={proposal.title || proposal.slug}
          >
            {proposal.title || proposal.slug}
          </WikiLink>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              proposal.sensitive
                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-[var(--sidebar-border)] text-[var(--text-muted)]"
            }`}
          >
            {proposal.sensitive ? "Sensitive" : "Public"}
          </span>
          {proposal.stats ? (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{proposal.stats.additions}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                -{proposal.stats.deletions}
              </span>
            </span>
          ) : null}
        </div>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusBadge}`}>
          {statusLabel}
        </span>
      </div>

      {proposal.filePath ? (
        <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)] truncate">
          {proposal.filePath}
          {proposal.branch ? ` · ${proposal.branch}` : ""}
        </div>
      ) : null}

      {!proposal.sensitive && proposal.readSensitiveInSession ? (
        <div
          className="mt-2 rounded border border-amber-300 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          role="note"
          data-test-id="wiki-edit-cross-visibility-warning"
        >
          This chat session read sensitive pages. Verify no private details appear in this diff before publishing to a public page.
        </div>
      ) : null}

      {proposal.summary ? (
        <p className="mt-2 text-[var(--text-muted)]">
          <span className="font-medium text-[var(--foreground)]">AI summary (untrusted): </span>
          {proposal.summary}
        </p>
      ) : null}

      {proposal.redactedDiff ? (
        <pre
          className="mt-2 max-h-72 overflow-auto rounded border border-[var(--sidebar-border)] bg-[var(--accent-light)]/40 p-2 font-mono text-[11px] leading-relaxed"
          data-test-id="wiki-edit-proposal-diff"
        >
          {diffLines.map((line, index) => {
            const lineClass = line.startsWith("+")
              ? "text-emerald-700 dark:text-emerald-300"
              : line.startsWith("-")
                ? "text-red-700 dark:text-red-300"
                : line.startsWith("@@")
                  ? "text-[var(--brand)]"
                  : "text-[var(--text-muted)]";
            return (
              <div key={index} className={lineClass}>
                {line || " "}
              </div>
            );
          })}
        </pre>
      ) : null}

      {actionError || proposal.error ? (
        <p
          className="mt-2 text-[11px] text-red-600 dark:text-red-400"
          role="alert"
          data-test-id="wiki-edit-proposal-action-error"
        >
          {actionError ?? proposal.error}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canApprove ? (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleAction("approve")}
              className="rounded bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              data-test-id="wiki-edit-approve"
            >
              {submitting === "approve" ? "Publishing…" : "Approve & Publish"}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleAction("reject")}
              className="rounded border border-[var(--sidebar-border)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent-light)] disabled:opacity-50"
              data-test-id="wiki-edit-reject"
            >
              {submitting === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </>
        ) : null}

        {canRetry ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleAction("approve")}
            className="rounded bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            data-test-id="wiki-edit-retry"
          >
            {submitting === "approve" ? "Retrying…" : "Retry Publish"}
          </button>
        ) : null}

        {proposal.commitUrl ? (
          <a
            href={proposal.commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[var(--brand)] hover:underline"
          >
            Commit {proposal.commitSha?.slice(0, 7)}
          </a>
        ) : null}
        {proposal.status === "published" ? (
          <WikiLink
            href={hrefForPage(proposal.slug)}
            className="text-[11px] text-[var(--brand)] hover:underline"
          >
            View updated page
          </WikiLink>
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
