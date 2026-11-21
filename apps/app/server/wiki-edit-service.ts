import crypto from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { parseMarkdownDocument } from "@oncobase/wiki-content/markdown-document";
import { applyValidatedWikiEdit, type WikiTextEdit } from "@oncobase/wiki-content/wiki-edit-patch";
import { parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { publishScopedDocumentsInProcess, type ScopedDocumentInput } from "./publish-api";
import {
  RepoConflictError,
  getRepoAdapterForSite,
  type VaultRepoAdapter,
} from "./repo-adapter";
import { DEFAULT_SITE_SLUG, withSiteSlug } from "./reader-access";

const MAX_SUMMARY_CHARS = 500;
const MAX_COMMIT_SUBJECT_CHARS = 120;

export class WikiEditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WikiEditError";
  }
}

function sanitizeCommitSubject(raw: string, fallbackSlug: string): string {
  // Take only the first non-empty line and strip control characters / git trailers
  // so model-provided text can never forge Co-authored-by or Oncobase-Proposal trailers.
  const firstLine = raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .find((line) => line.length > 0 && !/^[A-Za-z0-9-]+:\s/.test(line));
  const cleaned = (firstLine ?? `Update ${fallbackSlug}`).slice(0, MAX_COMMIT_SUBJECT_CHARS).trim();
  return cleaned || `Update ${fallbackSlug}`;
}

export function formatCommitMessage({
  subject,
  slug,
  approverName,
  approverEmail,
  proposalId,
}: {
  subject: string;
  slug: string;
  approverName: string | null;
  approverEmail: string;
  proposalId: string;
}): string {
  const safeSubject = sanitizeCommitSubject(subject, slug);
  const actor = approverName ? `${approverName} <${approverEmail}>` : approverEmail;
  return [
    safeSubject,
    "",
    `Edited via Oncobase Chat by ${actor}`,
    `Oncobase-Proposal: ${proposalId}`,
  ].join("\n");
}

async function resolveSitePiiPatterns(
  client: ConvexHttpClient,
  siteSlug: string,
): Promise<PiiPattern[] | undefined> {
  const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
  const configured = parseSitePiiPatterns(site?.config?.piiPatterns);
  if (configured.length > 0) return configured;
  return siteSlug === DEFAULT_SITE_SLUG ? undefined : [];
}

function isLeaseContentionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /publish already running|Publish conflict:/i.test(message);
}

export type ProposeWikiEditResult =
  | {
      ok: true;
      proposalId: string;
      slug: string;
      title: string;
      filePath: string;
      branch: string;
      sensitive: boolean;
      readSensitiveInSession: boolean;
      summary: string;
      commitMessage: string;
      redactedDiff: string;
      stats: { additions: number; deletions: number };
      status: "pending";
      expiresAt: number;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

export async function proposeWikiEdit({
  client,
  siteSlug,
  sessionTokenHash,
  ownerKey,
  conversationId,
  slug,
  edits,
  summary,
  commitMessage,
  readSensitiveInSession = false,
  repo: repoOverride,
}: {
  client: ConvexHttpClient;
  siteSlug: string;
  sessionTokenHash: string;
  ownerKey: string;
  conversationId?: string;
  slug: string;
  edits: WikiTextEdit[];
  summary: string;
  commitMessage?: string;
  readSensitiveInSession?: boolean;
  repo?: VaultRepoAdapter;
}): Promise<ProposeWikiEditResult> {
  const repo = repoOverride ?? getRepoAdapterForSite(siteSlug);
  if (!repo) {
    return {
      ok: false,
      code: "repo_not_configured",
      error: "Wiki editing is not configured for this site.",
    };
  }

  const normalizedSlug = slug.trim().replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
  if (!normalizedSlug || normalizedSlug.includes("..") || normalizedSlug.includes("\\")) {
    return { ok: false, code: "invalid_slug", error: "Invalid page slug." };
  }

  let file: Awaited<ReturnType<VaultRepoAdapter["resolveFile"]>>;
  try {
    file = await repo.resolveFile(normalizedSlug);
  } catch (error) {
    return {
      ok: false,
      code: "repo_read_failed",
      error: error instanceof Error ? error.message : "Failed to read page from repository.",
    };
  }
  if (!file) {
    return {
      ok: false,
      code: "not_found",
      error: `Page "${normalizedSlug}" was not found in the vault repository or is excluded from publishing.`,
    };
  }

  const convexDoc = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug: normalizedSlug, includeSensitive: true }),
  );
  if (!convexDoc) {
    return {
      ok: false,
      code: "not_published",
      error: `Page "${normalizedSlug}" does not exist in Convex yet. Publish it from the vault CLI before editing in Chat.`,
    };
  }

  const parsedGit = parseMarkdownDocument(normalizedSlug, file.raw);
  if (!convexDoc.contentHash || parsedGit.hash !== convexDoc.contentHash) {
    return {
      ok: false,
      code: "baseline_drift",
      error: `The Git repository and published wiki are out of sync for "${normalizedSlug}". Publish from an up-to-date vault checkout before editing in Chat.`,
    };
  }

  const piiPatterns = await resolveSitePiiPatterns(client, siteSlug);
  const validated = applyValidatedWikiEdit({
    slug: normalizedSlug,
    baseRaw: file.raw,
    edits,
    piiPatterns,
  });
  if (!validated.ok) {
    return { ok: false, code: validated.code, error: validated.error };
  }

  const cleanSummary = summary.trim().slice(0, MAX_SUMMARY_CHARS) || `Edit ${normalizedSlug}`;
  const cleanCommitMessage = sanitizeCommitSubject(
    commitMessage?.trim() || cleanSummary,
    normalizedSlug,
  );

  const created = await client.mutation(
    api.wikiEdits.createProposal,
    {
      siteSlug,
      sessionTokenHash,
      ownerKey,
      ...(conversationId ? { conversationId } : {}),
      slug: normalizedSlug,
      title: validated.parsedBase.title,
      filePath: file.filePath,
      branch: repo.branch,
      baseFileSha: file.sha,
      baseContentHash: convexDoc.contentHash,
      sensitive: validated.parsedBase.sensitive,
      readSensitiveInSession,
      edits,
      summary: cleanSummary,
      commitMessage: cleanCommitMessage,
      redactedDiff: validated.redactedDiff,
      stats: validated.stats,
    },
    { skipQueue: true },
  );

  return {
    ok: true,
    proposalId: String(created.proposalId),
    slug: normalizedSlug,
    title: validated.parsedBase.title,
    filePath: file.filePath,
    branch: repo.branch,
    sensitive: validated.parsedBase.sensitive,
    readSensitiveInSession,
    summary: cleanSummary,
    commitMessage: cleanCommitMessage,
    redactedDiff: validated.redactedDiff,
    stats: validated.stats,
    status: "pending",
    expiresAt: created.expiresAt,
  };
}

export async function approveAndPublishWikiEdit({
  client,
  siteSlug,
  sessionTokenHash,
  ownerKey,
  proposalId,
  repo: repoOverride,
  embedDocument,
}: {
  client: ConvexHttpClient;
  siteSlug: string;
  sessionTokenHash: string;
  ownerKey: string;
  proposalId: string;
  repo?: VaultRepoAdapter;
  embedDocument?: (doc: ScopedDocumentInput) => Promise<number[] | undefined>;
}) {
  const repo = repoOverride ?? getRepoAdapterForSite(siteSlug);
  if (!repo) {
    throw new WikiEditError(503, "repo_not_configured", "Wiki editing is not configured for this site.");
  }

  const executionId = crypto.randomUUID();
  const { proposal, approver } = await client.mutation(
    api.wikiEdits.claimForExecution,
    { siteSlug, sessionTokenHash, ownerKey, proposalId, executionId },
    { skipQueue: true },
  );
  const typedProposalId = proposal._id as Id<"wikiEditProposals">;

  try {
    const piiPatterns = await resolveSitePiiPatterns(client, siteSlug);

    // Check whether a prior interrupted execution already landed the Git commit
    // (either recorded on the row or discoverable via the Oncobase-Proposal trailer).
    let commitSha = proposal.commitSha;
    let commitUrl = proposal.commitUrl;
    if (!commitSha) {
      const recovered = await repo.findCommitByProposalId(String(proposal._id));
      if (recovered) {
        commitSha = recovered.commitSha;
        commitUrl = recovered.commitUrl;
        await client.mutation(
          api.wikiEdits.recordCommit,
          {
            siteSlug,
            proposalId: typedProposalId,
            executionId,
            commitSha,
            commitUrl,
          },
          { skipQueue: true },
        );
      }
    }

    let docToPublish: ScopedDocumentInput;

    if (!commitSha) {
      const liveFile = await repo.resolveFile(proposal.slug);
      if (!liveFile) {
        throw new WikiEditError(409, "file_missing", `Page "${proposal.slug}" no longer exists in the repository.`);
      }
      if (liveFile.sha !== proposal.baseFileSha) {
        throw new WikiEditError(
          409,
          "repo_conflict",
          "The page in GitHub changed after this edit was proposed. Ask Chat to re-read the page and propose a fresh edit.",
        );
      }
      const convexDoc = await client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, { slug: proposal.slug, includeSensitive: true }),
      );
      if (!convexDoc || convexDoc.contentHash !== proposal.baseContentHash) {
        throw new WikiEditError(
          409,
          "convex_conflict",
          "The published wiki page changed after this edit was proposed. Ask Chat to re-read the page and propose a fresh edit.",
        );
      }

      const validated = applyValidatedWikiEdit({
        slug: proposal.slug,
        baseRaw: liveFile.raw,
        edits: proposal.edits,
        piiPatterns,
      });
      if (!validated.ok) {
        throw new WikiEditError(409, validated.code, validated.error);
      }

      const fullCommitMessage = formatCommitMessage({
        subject: proposal.commitMessage,
        slug: proposal.slug,
        approverName: approver.name,
        approverEmail: approver.email,
        proposalId: String(proposal._id),
      });

      const committed = await repo.commitFile({
        filePath: liveFile.filePath,
        content: validated.proposedRaw,
        baseSha: liveFile.sha,
        message: fullCommitMessage,
        author: {
          name: approver.name || approver.email,
          email: approver.email,
        },
      });
      commitSha = committed.commitSha;
      commitUrl = committed.commitUrl;

      // Persist commit SHA immediately before attempting any Convex publish writes.
      await client.mutation(
        api.wikiEdits.recordCommit,
        {
          siteSlug,
          proposalId: typedProposalId,
          executionId,
          commitSha,
          commitUrl,
        },
        { skipQueue: true },
      );

      docToPublish = {
        slug: validated.parsedProposed.slug,
        title: validated.parsedProposed.title,
        content: validated.parsedProposed.content,
        tags: validated.parsedProposed.tags,
        sensitiveInclude: validated.parsedProposed.sensitiveInclude,
        hash: validated.parsedProposed.hash,
        sensitive: validated.parsedProposed.sensitive,
      };
    } else {
      // Retry/reconcile path: Git commit already landed; publish the live committed content.
      const liveFile = await repo.resolveFile(proposal.slug);
      if (!liveFile) {
        throw new WikiEditError(409, "file_missing", `Page "${proposal.slug}" was not found in the repository during publish retry.`);
      }
      const parsed = parseMarkdownDocument(proposal.slug, liveFile.raw);
      docToPublish = {
        slug: parsed.slug,
        title: parsed.title,
        content: parsed.content,
        tags: parsed.tags,
        sensitiveInclude: parsed.sensitiveInclude,
        hash: parsed.hash,
        sensitive: parsed.sensitive,
      };
    }

    try {
      const published = await publishScopedDocumentsInProcess({
        client,
        siteSlug,
        documents: [docToPublish],
        embedDocument,
      });
      const updated = await client.mutation(
        api.wikiEdits.markPublished,
        {
          siteSlug,
          proposalId: typedProposalId,
          executionId,
          publishedRevision: published.revision,
          commitSha,
          commitUrl,
        },
        { skipQueue: true },
      );
      return { status: "published" as const, proposal: updated, revision: published.revision };
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : String(publishError);
      if (isLeaseContentionError(publishError)) {
        const pending = await client.mutation(
          api.wikiEdits.markPendingPublish,
          {
            siteSlug,
            proposalId: typedProposalId,
            executionId,
            error: "Another publish is currently running for this site. The Git commit succeeded; retry publishing once the active publish finishes.",
          },
          { skipQueue: true },
        );
        return {
          status: "committed_pending_publish" as const,
          proposal: pending,
          retryable: true as const,
        };
      }
      await client
        .mutation(
          api.wikiEdits.markPendingPublish,
          {
            siteSlug,
            proposalId: typedProposalId,
            executionId,
            error: `Git commit succeeded (${commitSha.slice(0, 7)}), but publishing to Convex failed: ${message}`,
          },
          { skipQueue: true },
        )
        .catch(() => {});
      throw new WikiEditError(
        502,
        "publish_failed_after_commit",
        `Git commit succeeded (${commitSha.slice(0, 7)}), but publishing to Convex failed: ${message}`,
      );
    }
  } catch (error) {
    if (error instanceof WikiEditError && error.code === "publish_failed_after_commit") {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await client
      .mutation(
        api.wikiEdits.markFailed,
        { siteSlug, proposalId: typedProposalId, executionId, error: message },
        { skipQueue: true },
      )
      .catch(() => {});
    if (error instanceof RepoConflictError) {
      throw new WikiEditError(409, "repo_conflict", error.message);
    }
    throw error;
  }
}

export async function rejectWikiEdit({
  client,
  siteSlug,
  sessionTokenHash,
  ownerKey,
  proposalId,
}: {
  client: ConvexHttpClient;
  siteSlug: string;
  sessionTokenHash: string;
  ownerKey: string;
  proposalId: string;
}) {
  return client.mutation(
    api.wikiEdits.rejectProposal,
    { siteSlug, sessionTokenHash, ownerKey, proposalId },
    { skipQueue: true },
  );
}
