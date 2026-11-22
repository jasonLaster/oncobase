"use client";

import { useChatRuntime } from "@oncobase/chat/runtime";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type WikiEditProposalStatus =
  | "pending"
  | "executing"
  | "committed_pending_publish"
  | "published"
  | "rejected"
  | "failed"
  | "expired";

export type WikiEditProposalFile = {
  slug: string;
  title: string;
  filePath: string;
  operation: "edit" | "create";
  sensitive: boolean;
  redactedDiff: string;
  redactedPreview?: string;
  firstChangedHeading?: string;
  stats: { additions: number; deletions: number };
};

export type WikiEditProposalState = {
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
  files: WikiEditProposalFile[];
  status: WikiEditProposalStatus;
  commitSha?: string;
  commitUrl?: string;
  publishedRevision?: number;
  error?: string;
};

type RawProposalPayload = Partial<Omit<WikiEditProposalState, "proposalId" | "files">> & {
  _id?: string;
  proposalId?: string;
  files?: Array<Partial<WikiEditProposalFile> & { slug: string }>;
};

export function normalizeWikiEditProposal(
  raw: RawProposalPayload | null | undefined,
  fallbackId?: string,
  fallbackSlug?: string,
): WikiEditProposalState | null {
  const proposalId = raw?.proposalId ?? raw?._id ?? fallbackId;
  if (!proposalId) return null;

  const files: WikiEditProposalFile[] =
    Array.isArray(raw?.files) && raw.files.length > 0
      ? raw.files.map((file) => ({
          slug: file.slug,
          title: file.title ?? file.slug.split("/").pop() ?? file.slug,
          filePath: file.filePath ?? `${file.slug}.md`,
          operation: file.operation === "create" ? "create" : "edit",
          sensitive: Boolean(file.sensitive),
          redactedDiff: file.redactedDiff ?? "",
          ...(file.redactedPreview !== undefined ? { redactedPreview: file.redactedPreview } : {}),
          ...(file.firstChangedHeading ? { firstChangedHeading: file.firstChangedHeading } : {}),
          stats: file.stats ?? { additions: 0, deletions: 0 },
        }))
      : (() => {
          const slug = raw?.slug ?? fallbackSlug ?? "";
          if (!slug) return [];
          return [
            {
              slug,
              title: raw?.title ?? slug.split("/").pop() ?? slug,
              filePath: raw?.filePath ?? `${slug}.md`,
              operation: "edit" as const,
              sensitive: Boolean(raw?.sensitive),
              redactedDiff: raw?.redactedDiff ?? "",
              stats: raw?.stats ?? { additions: 0, deletions: 0 },
            },
          ];
        })();

  if (files.length === 0) return null;
  const primary = files[0]!;
  const stats =
    raw?.stats ??
    files.reduce(
      (acc, file) => ({
        additions: acc.additions + file.stats.additions,
        deletions: acc.deletions + file.stats.deletions,
      }),
      { additions: 0, deletions: 0 },
    );

  return {
    proposalId,
    slug: raw?.slug ?? primary.slug,
    title: raw?.title ?? primary.title,
    filePath: raw?.filePath ?? primary.filePath,
    branch: raw?.branch,
    sensitive: raw?.sensitive ?? files.every((file) => file.sensitive),
    readSensitiveInSession: raw?.readSensitiveInSession,
    summary: raw?.summary,
    redactedDiff: raw?.redactedDiff ?? primary.redactedDiff,
    stats,
    files,
    status: raw?.status ?? "pending",
    commitSha: raw?.commitSha,
    commitUrl: raw?.commitUrl,
    publishedRevision: raw?.publishedRevision,
    error: raw?.error,
  };
}

function mergeProposalPreservingPreviews(
  previous: WikiEditProposalState | undefined,
  next: WikiEditProposalState,
): WikiEditProposalState {
  if (!previous) return next;
  const prevBySlug = new Map(previous.files.map((file) => [file.slug, file]));
  return {
    ...next,
    files: next.files.map((file) => {
      if (file.redactedPreview !== undefined) return file;
      const prev = prevBySlug.get(file.slug);
      return prev?.redactedPreview !== undefined
        ? {
            ...file,
            redactedPreview: prev.redactedPreview,
            firstChangedHeading: file.firstChangedHeading ?? prev.firstChangedHeading,
          }
        : file;
    }),
  };
}

export interface WikiEditReviewContextValue {
  activeProposalId: string | null;
  activeProposal: WikiEditProposalState | null;
  selectedFileSlug: string | null;
  loadingPreview: boolean;
  submittingAction: "approve" | "reject" | null;
  actionError: string | null;
  getProposal: (proposalId: string) => WikiEditProposalState | undefined;
  seedProposal: (proposal: WikiEditProposalState) => void;
  openProposal: (proposalId: string, initial?: WikiEditProposalState | null, fileSlug?: string) => void;
  closePanel: () => void;
  selectFile: (slug: string) => void;
  refreshProposal: (proposalId: string, options?: { includePreview?: boolean }) => Promise<WikiEditProposalState | null>;
  submitAction: (proposalId: string, action: "approve" | "reject") => Promise<void>;
}

const WikiEditReviewContext = createContext<WikiEditReviewContextValue | null>(null);

export function WikiEditReviewProvider({ children }: { children: ReactNode }) {
  const { onWikiEdited } = useChatRuntime();
  const [proposalsById, setProposalsById] = useState<Record<string, WikiEditProposalState>>({});
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [selectedFileSlug, setSelectedFileSlug] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlightRefresh = useRef(new Map<string, Promise<WikiEditProposalState | null>>());

  const upsertProposal = useCallback((proposal: WikiEditProposalState) => {
    setProposalsById((current) => ({
      ...current,
      [proposal.proposalId]: mergeProposalPreservingPreviews(
        current[proposal.proposalId],
        proposal,
      ),
    }));
  }, []);

  const seedProposal = useCallback((proposal: WikiEditProposalState) => {
    setProposalsById((current) => {
      if (current[proposal.proposalId]) return current;
      return { ...current, [proposal.proposalId]: proposal };
    });
  }, []);

  const refreshProposal = useCallback(
    async (
      proposalId: string,
      options?: { includePreview?: boolean },
    ): Promise<WikiEditProposalState | null> => {
      const includePreview = Boolean(options?.includePreview);
      const dedupeKey = `${proposalId}:${includePreview ? "preview" : "summary"}`;
      const existing = inFlightRefresh.current.get(dedupeKey);
      if (existing) return existing;

      if (includePreview) setLoadingPreview(true);
      const request = (async () => {
        try {
          const query = includePreview
            ? `id=${encodeURIComponent(proposalId)}&includePreview=1`
            : `id=${encodeURIComponent(proposalId)}`;
          const response = await fetch(`/api/chat/wiki-edits?${query}`, {
            credentials: "same-origin",
          });
          if (!response.ok) return null;
          const body = (await response.json()) as { proposal?: RawProposalPayload };
          const normalized = normalizeWikiEditProposal(body.proposal, proposalId);
          if (normalized) upsertProposal(normalized);
          return normalized;
        } catch {
          return null;
        } finally {
          inFlightRefresh.current.delete(dedupeKey);
          if (includePreview) setLoadingPreview(false);
        }
      })();
      inFlightRefresh.current.set(dedupeKey, request);
      return request;
    },
    [upsertProposal],
  );

  const openProposal = useCallback(
    (proposalId: string, initial?: WikiEditProposalState | null, fileSlug?: string) => {
      if (initial) upsertProposal(initial);
      setActiveProposalId(proposalId);
      setActionError(null);
      setSelectedFileSlug(fileSlug ?? initial?.files[0]?.slug ?? null);
      void refreshProposal(proposalId, { includePreview: true });
    },
    [refreshProposal, upsertProposal],
  );

  const closePanel = useCallback(() => {
    setActiveProposalId(null);
    setActionError(null);
  }, []);

  const selectFile = useCallback((slug: string) => {
    setSelectedFileSlug(slug);
  }, []);

  const submitAction = useCallback(
    async (proposalId: string, action: "approve" | "reject") => {
      if (submittingAction) return;
      setSubmittingAction(action);
      setActionError(null);
      try {
        const response = await fetch(`/api/chat/wiki-edits/${action}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          proposal?: RawProposalPayload;
          revision?: number;
          error?: string;
        };
        const normalized = normalizeWikiEditProposal(body.proposal, proposalId);
        if (normalized) upsertProposal(normalized);

        if (!response.ok) {
          setActionError(body.error ?? `Could not ${action} edit (${response.status})`);
          await refreshProposal(proposalId, { includePreview: true });
          return;
        }
        if (action === "approve" && normalized?.status === "published") {
          onWikiEdited?.({ slug: normalized.slug, revision: body.revision });
          void refreshProposal(proposalId, { includePreview: true });
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : `Failed to ${action} edit`);
      } finally {
        setSubmittingAction(null);
      }
    },
    [onWikiEdited, refreshProposal, submittingAction, upsertProposal],
  );

  const activeProposal = activeProposalId ? (proposalsById[activeProposalId] ?? null) : null;
  const resolvedSelectedSlug = useMemo(() => {
    if (!activeProposal) return null;
    if (selectedFileSlug && activeProposal.files.some((f) => f.slug === selectedFileSlug)) {
      return selectedFileSlug;
    }
    return activeProposal.files[0]?.slug ?? null;
  }, [activeProposal, selectedFileSlug]);

  const getProposal = useCallback(
    (proposalId: string) => proposalsById[proposalId],
    [proposalsById],
  );

  const value = useMemo<WikiEditReviewContextValue>(
    () => ({
      activeProposalId,
      activeProposal,
      selectedFileSlug: resolvedSelectedSlug,
      loadingPreview,
      submittingAction,
      actionError,
      getProposal,
      seedProposal,
      openProposal,
      closePanel,
      selectFile,
      refreshProposal,
      submitAction,
    }),
    [
      activeProposalId,
      activeProposal,
      resolvedSelectedSlug,
      loadingPreview,
      submittingAction,
      actionError,
      getProposal,
      seedProposal,
      openProposal,
      closePanel,
      selectFile,
      refreshProposal,
      submitAction,
    ],
  );

  return (
    <WikiEditReviewContext.Provider value={value}>
      {children}
    </WikiEditReviewContext.Provider>
  );
}

export function useWikiEditReview(): WikiEditReviewContextValue | null {
  return useContext(WikiEditReviewContext);
}
