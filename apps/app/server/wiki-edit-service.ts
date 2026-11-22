import crypto from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import {
  compileOncobaseIgnore,
  parseMarkdownDocument,
  splitFrontmatter,
} from "@oncobase/wiki-content/markdown-document";
import {
  applyValidatedWikiEdit,
  computeRedactedPreview,
  findFirstChangedHeading,
  validateNewWikiPage,
  type WikiTextEdit,
} from "@oncobase/wiki-content/wiki-edit-patch";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { publishScopedDocumentsInProcess, type ScopedDocumentInput } from "./publish-api";
import {
  RepoConflictError,
  getRepoAdapterForSite,
  type RepoFileCommitInput,
  type VaultRepoAdapter,
} from "./repo-adapter";
import { DEFAULT_SITE_SLUG, withSiteSlug } from "./reader-access";

const MAX_SUMMARY_CHARS = 500;
const MAX_COMMIT_SUBJECT_CHARS = 120;
export const MAX_PAGES_PER_PROPOSAL = 10;

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

export type WikiPageChangeInput =
  | {
      operation?: "edit";
      slug: string;
      edits: WikiTextEdit[];
    }
  | {
      operation: "create";
      slug: string;
      title: string;
      tags?: string[];
      sensitive?: boolean;
      body: string;
    };

export type ProposalFileSummary = {
  slug: string;
  title: string;
  filePath: string;
  operation: "edit" | "create";
  sensitive: boolean;
  redactedDiff: string;
  stats: { additions: number; deletions: number };
  firstChangedHeading?: string;
};

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
      files: ProposalFileSummary[];
      status: "pending";
      expiresAt: number;
    }
  | {
      ok: false;
      code: string;
      error: string;
      errors?: Array<{ slug: string; code: string; error: string }>;
    };

type PreparedProposalFile = {
  slug: string;
  title: string;
  filePath: string;
  operation: "edit" | "create";
  baseFileSha?: string;
  baseContentHash?: string;
  sensitive: boolean;
  edits: WikiTextEdit[];
  newContent?: string;
  redactedDiff: string;
  stats: { additions: number; deletions: number };
  firstChangedHeading?: string;
};

function normalizeInputPages(args: {
  slug?: string;
  edits?: WikiTextEdit[];
  pages?: WikiPageChangeInput[];
}): WikiPageChangeInput[] {
  if (Array.isArray(args.pages) && args.pages.length > 0) return args.pages;
  if (typeof args.slug === "string" && Array.isArray(args.edits)) {
    return [{ operation: "edit", slug: args.slug, edits: args.edits }];
  }
  return [];
}

export async function proposeWikiEdit({
  client,
  siteSlug,
  sessionTokenHash,
  ownerKey,
  conversationId,
  slug,
  edits,
  pages: rawPages,
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
  slug?: string;
  edits?: WikiTextEdit[];
  pages?: WikiPageChangeInput[];
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

  const pages = normalizeInputPages({ slug, edits, pages: rawPages });
  if (pages.length === 0) {
    return { ok: false, code: "invalid_pages", error: "Provide at least one page to edit or create." };
  }
  if (pages.length > MAX_PAGES_PER_PROPOSAL) {
    return {
      ok: false,
      code: "too_many_pages",
      error: `At most ${MAX_PAGES_PER_PROPOSAL} pages can be updated in one proposal.`,
    };
  }

  const [piiPatterns, ignoreRulesRaw] = await Promise.all([
    resolveSitePiiPatterns(client, siteSlug),
    repo.readIgnoreRules().catch(() => null),
  ]);
  const ignoreMatchers = compileOncobaseIgnore(ignoreRulesRaw);

  const seenSlugs = new Set<string>();
  const prepared: PreparedProposalFile[] = [];
  const errors: Array<{ slug: string; code: string; error: string }> = [];

  for (const page of pages) {
    const normalizedSlug = page.slug.trim().replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
    if (!normalizedSlug || normalizedSlug.includes("..") || normalizedSlug.includes("\\")) {
      errors.push({ slug: page.slug, code: "invalid_slug", error: "Invalid page slug." });
      continue;
    }
    const slugKey = normalizedSlug.toLowerCase();
    if (seenSlugs.has(slugKey)) {
      errors.push({
        slug: normalizedSlug,
        code: "duplicate_slug",
        error: `Page "${normalizedSlug}" appears more than once in this proposal; combine edits for the same page.`,
      });
      continue;
    }
    seenSlugs.add(slugKey);

    if (page.operation === "create") {
      const validated = validateNewWikiPage({
        slug: normalizedSlug,
        title: page.title,
        tags: page.tags,
        sensitive: page.sensitive ?? true,
        body: page.body,
        piiPatterns,
        ignoreMatchers,
      });
      if (!validated.ok) {
        errors.push({ slug: normalizedSlug, code: validated.code, error: validated.error });
        continue;
      }

      let existingGit: Awaited<ReturnType<VaultRepoAdapter["resolveFile"]>>;
      try {
        existingGit = await repo.resolveFile(validated.slug);
      } catch (error) {
        errors.push({
          slug: validated.slug,
          code: "repo_read_failed",
          error: error instanceof Error ? error.message : "Failed to check repository for existing page.",
        });
        continue;
      }
      if (existingGit) {
        errors.push({
          slug: validated.slug,
          code: "already_exists",
          error: `Page "${validated.slug}" already exists in the vault repository. Use operation: "edit" instead.`,
        });
        continue;
      }

      const existingConvex = await client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, { slug: validated.slug, includeSensitive: true }),
      );
      if (existingConvex) {
        errors.push({
          slug: validated.slug,
          code: "already_exists",
          error: `Page "${validated.slug}" already exists in the published wiki. Use operation: "edit" instead.`,
        });
        continue;
      }

      prepared.push({
        slug: validated.slug,
        title: validated.parsedProposed.title,
        filePath: validated.filePath,
        operation: "create",
        sensitive: validated.parsedProposed.sensitive,
        edits: [],
        newContent: validated.proposedRaw,
        redactedDiff: validated.redactedDiff,
        stats: validated.stats,
        ...(validated.firstChangedHeading ? { firstChangedHeading: validated.firstChangedHeading } : {}),
      });
      continue;
    }

    // operation === "edit"
    let file: Awaited<ReturnType<VaultRepoAdapter["resolveFile"]>>;
    try {
      file = await repo.resolveFile(normalizedSlug);
    } catch (error) {
      errors.push({
        slug: normalizedSlug,
        code: "repo_read_failed",
        error: error instanceof Error ? error.message : "Failed to read page from repository.",
      });
      continue;
    }
    if (!file) {
      errors.push({
        slug: normalizedSlug,
        code: "not_found",
        error: `Page "${normalizedSlug}" was not found in the vault repository or is excluded from publishing.`,
      });
      continue;
    }

    const convexDoc = await client.query(
      api.documents.getBySlug,
      withSiteSlug(siteSlug, { slug: normalizedSlug, includeSensitive: true }),
    );
    if (!convexDoc) {
      errors.push({
        slug: normalizedSlug,
        code: "not_published",
        error: `Page "${normalizedSlug}" does not exist in Convex yet. Publish it from the vault CLI before editing in Chat.`,
      });
      continue;
    }

    const parsedGit = parseMarkdownDocument(normalizedSlug, file.raw);
    if (!convexDoc.contentHash || parsedGit.hash !== convexDoc.contentHash) {
      errors.push({
        slug: normalizedSlug,
        code: "baseline_drift",
        error: `The Git repository and published wiki are out of sync for "${normalizedSlug}". Publish from an up-to-date vault checkout before editing in Chat.`,
      });
      continue;
    }

    const validated = applyValidatedWikiEdit({
      slug: normalizedSlug,
      baseRaw: file.raw,
      edits: page.edits,
      piiPatterns,
    });
    if (!validated.ok) {
      errors.push({ slug: normalizedSlug, code: validated.code, error: validated.error });
      continue;
    }

    prepared.push({
      slug: normalizedSlug,
      title: validated.parsedBase.title,
      filePath: file.filePath,
      operation: "edit",
      baseFileSha: file.sha,
      baseContentHash: convexDoc.contentHash,
      sensitive: validated.parsedBase.sensitive,
      edits: page.edits,
      redactedDiff: validated.redactedDiff,
      stats: validated.stats,
      ...(validated.firstChangedHeading ? { firstChangedHeading: validated.firstChangedHeading } : {}),
    });
  }

  if (errors.length > 0) {
    const first = errors[0]!;
    return {
      ok: false,
      code: first.code,
      error:
        errors.length === 1
          ? first.error
          : errors.map((e) => `${e.slug}: ${e.error}`).join("\n"),
      errors,
    };
  }

  const primary = prepared[0]!;
  const aggregateStats = prepared.reduce(
    (acc, item) => ({
      additions: acc.additions + item.stats.additions,
      deletions: acc.deletions + item.stats.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  // Conservative top-level visibility flag for V1 compatibility: false if ANY page is public.
  const allSensitive = prepared.every((item) => item.sensitive);
  const fallbackLabel =
    prepared.length === 1 ? primary.slug : `${prepared.length} wiki pages`;
  const cleanSummary = summary.trim().slice(0, MAX_SUMMARY_CHARS) || `Edit ${fallbackLabel}`;
  const cleanCommitMessage = sanitizeCommitSubject(
    commitMessage?.trim() || cleanSummary,
    fallbackLabel,
  );

  const created = await client.mutation(
    api.wikiEdits.createProposal,
    {
      siteSlug,
      sessionTokenHash,
      ownerKey,
      ...(conversationId ? { conversationId } : {}),
      slug: primary.slug,
      title: primary.title,
      filePath: primary.filePath,
      branch: repo.branch,
      baseFileSha: primary.baseFileSha ?? "",
      baseContentHash: primary.baseContentHash ?? "",
      sensitive: allSensitive,
      readSensitiveInSession,
      edits: primary.edits,
      summary: cleanSummary,
      commitMessage: cleanCommitMessage,
      redactedDiff: primary.redactedDiff,
      stats: aggregateStats,
      files: prepared,
    },
    { skipQueue: true },
  );

  const fileSummaries: ProposalFileSummary[] = prepared.map((item) => ({
    slug: item.slug,
    title: item.title,
    filePath: item.filePath,
    operation: item.operation,
    sensitive: item.sensitive,
    redactedDiff: item.redactedDiff,
    stats: item.stats,
    ...(item.firstChangedHeading ? { firstChangedHeading: item.firstChangedHeading } : {}),
  }));

  return {
    ok: true,
    proposalId: String(created.proposalId),
    slug: primary.slug,
    title: primary.title,
    filePath: primary.filePath,
    branch: repo.branch,
    sensitive: allSensitive,
    readSensitiveInSession,
    summary: cleanSummary,
    commitMessage: cleanCommitMessage,
    redactedDiff: primary.redactedDiff,
    stats: aggregateStats,
    files: fileSummaries,
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
  const files = proposal.files;

  try {
    const piiPatterns = await resolveSitePiiPatterns(client, siteSlug);

    // Check whether a prior interrupted execution already landed the Git commit.
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

    const docsToPublish: ScopedDocumentInput[] = [];

    if (!commitSha) {
      const commitInputs: RepoFileCommitInput[] = [];

      for (const item of files) {
        if (item.operation === "create") {
          const existingGit = await repo.resolveFile(item.slug);
          if (existingGit) {
            throw new WikiEditError(
              409,
              "already_exists",
              `Page "${item.slug}" now already exists in GitHub.`,
            );
          }
          const existingConvex = await client.query(
            api.documents.getBySlug,
            withSiteSlug(siteSlug, { slug: item.slug, includeSensitive: true }),
          );
          if (existingConvex) {
            throw new WikiEditError(
              409,
              "already_exists",
              `Page "${item.slug}" now already exists in the published wiki.`,
            );
          }
          if (!item.newContent) {
            throw new WikiEditError(
              400,
              "missing_content",
              `Proposal for new page "${item.slug}" is missing its generated content.`,
            );
          }
          const parsed = parseMarkdownDocument(item.slug, item.newContent);
          commitInputs.push({
            filePath: item.filePath,
            content: item.newContent,
            operation: "create",
          });
          docsToPublish.push({
            slug: parsed.slug,
            title: parsed.title,
            content: parsed.content,
            tags: parsed.tags,
            sensitiveInclude: parsed.sensitiveInclude,
            hash: parsed.hash,
            sensitive: parsed.sensitive,
          });
        } else {
          const liveFile = await repo.resolveFile(item.slug);
          if (!liveFile) {
            throw new WikiEditError(
              409,
              "file_missing",
              `Page "${item.slug}" no longer exists in the repository.`,
            );
          }
          if (liveFile.sha !== item.baseFileSha) {
            throw new WikiEditError(
              409,
              "repo_conflict",
              `The page "${item.slug}" in GitHub changed after this edit was proposed. Ask Chat to re-read the page and propose a fresh edit.`,
            );
          }
          const convexDoc = await client.query(
            api.documents.getBySlug,
            withSiteSlug(siteSlug, { slug: item.slug, includeSensitive: true }),
          );
          if (!convexDoc || convexDoc.contentHash !== item.baseContentHash) {
            throw new WikiEditError(
              409,
              "convex_conflict",
              `The published wiki page "${item.slug}" changed after this edit was proposed. Ask Chat to re-read the page and propose a fresh edit.`,
            );
          }

          const validated = applyValidatedWikiEdit({
            slug: item.slug,
            baseRaw: liveFile.raw,
            edits: item.edits,
            piiPatterns,
          });
          if (!validated.ok) {
            throw new WikiEditError(409, validated.code, validated.error);
          }

          commitInputs.push({
            filePath: liveFile.filePath,
            content: validated.proposedRaw,
            operation: "edit",
            baseSha: liveFile.sha,
          });
          docsToPublish.push({
            slug: validated.parsedProposed.slug,
            title: validated.parsedProposed.title,
            content: validated.parsedProposed.content,
            tags: validated.parsedProposed.tags,
            sensitiveInclude: validated.parsedProposed.sensitiveInclude,
            hash: validated.parsedProposed.hash,
            sensitive: validated.parsedProposed.sensitive,
          });
        }
      }

      const fullCommitMessage = formatCommitMessage({
        subject: proposal.commitMessage,
        slug: files.length === 1 ? proposal.slug : `${files.length} wiki pages`,
        approverName: approver.name,
        approverEmail: approver.email,
        proposalId: String(proposal._id),
      });

      const committed =
        commitInputs.length === 1 && commitInputs[0]!.operation === "edit" && commitInputs[0]!.baseSha
          ? await repo.commitFile({
              filePath: commitInputs[0]!.filePath,
              content: commitInputs[0]!.content,
              baseSha: commitInputs[0]!.baseSha,
              message: fullCommitMessage,
              author: {
                name: approver.name || approver.email,
                email: approver.email,
              },
            })
          : await repo.commitFiles({
              files: commitInputs,
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
    } else {
      // Retry/reconcile path: Git commit already landed; publish all committed files.
      for (const item of files) {
        const liveFile = await repo.resolveFile(item.slug, commitSha);
        if (!liveFile) {
          throw new WikiEditError(
            409,
            "file_missing",
            `Page "${item.slug}" was not found in the repository during publish retry.`,
          );
        }
        const parsed = parseMarkdownDocument(item.slug, liveFile.raw);
        docsToPublish.push({
          slug: parsed.slug,
          title: parsed.title,
          content: parsed.content,
          tags: parsed.tags,
          sensitiveInclude: parsed.sensitiveInclude,
          hash: parsed.hash,
          sensitive: parsed.sensitive,
        });
      }
    }

    try {
      const published = await publishScopedDocumentsInProcess({
        client,
        siteSlug,
        documents: docsToPublish,
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
      return {
        status: "published" as const,
        proposal: updated,
        revision: published.revision,
        slugs: docsToPublish.map((doc) => doc.slug),
      };
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

/**
 * Compute PII-redacted full Markdown previews on demand for GET /api/chat/wiki-edits?includePreview=1.
 * Avoids storing large full-page previews inside Convex wikiEditProposals rows while keeping
 * Preview strictly redacted and fast (zero GitHub API calls).
 */
export async function hydrateProposalPreviews<
  T extends {
    status: string;
    files: Array<{
      slug: string;
      title: string;
      filePath: string;
      operation: "edit" | "create";
      sensitive: boolean;
      edits: WikiTextEdit[];
      newContent?: string;
      redactedDiff: string;
      stats: { additions: number; deletions: number };
      firstChangedHeading?: string;
    }>;
  },
>({
  client,
  siteSlug,
  proposal,
}: {
  client: ConvexHttpClient;
  siteSlug: string;
  proposal: T;
}) {
  const piiPatterns = await resolveSitePiiPatterns(client, siteSlug);
  const hydratedFiles = await Promise.all(
    proposal.files.map(async (file) => {
      const { newContent, ...safeFile } = file;
      if (file.operation === "create") {
        let previewBody: string | undefined;
        if (newContent) {
          const { body } = splitFrontmatter(newContent);
          previewBody = applyPiiRedactions(body, { patterns: piiPatterns });
        } else if (proposal.status === "published") {
          const doc = await client
            .query(
              api.documents.getBySlug,
              withSiteSlug(siteSlug, { slug: file.slug, includeSensitive: true }),
            )
            .catch(() => null);
          if (doc) previewBody = `# ${doc.title}\n\n${doc.content}`;
        }
        const heading =
          file.firstChangedHeading ??
          (previewBody ? findFirstChangedHeading(previewBody, file.redactedDiff) ?? undefined : undefined);
        return {
          ...safeFile,
          ...(previewBody ? { redactedPreview: previewBody } : {}),
          ...(heading ? { firstChangedHeading: heading } : {}),
        };
      }

      const convexDoc = await client
        .query(
          api.documents.getBySlug,
          withSiteSlug(siteSlug, { slug: file.slug, includeSensitive: true }),
        )
        .catch(() => null);
      if (!convexDoc) return safeFile;

      const fullConvexMarkdown = `# ${convexDoc.title}\n\n${convexDoc.content}`;
      if (proposal.status === "published") {
        const heading =
          file.firstChangedHeading ??
          findFirstChangedHeading(fullConvexMarkdown, file.redactedDiff) ??
          undefined;
        return {
          ...safeFile,
          redactedPreview: fullConvexMarkdown,
          ...(heading ? { firstChangedHeading: heading } : {}),
        };
      }

      const computed =
        computeRedactedPreview({
          baseRedactedBody: fullConvexMarkdown,
          edits: file.edits,
          redactedDiff: file.redactedDiff,
        }) ??
        (() => {
          const bodyOnly = computeRedactedPreview({
            baseRedactedBody: convexDoc.content,
            edits: file.edits,
            redactedDiff: file.redactedDiff,
          });
          return bodyOnly
            ? {
                redactedProposedBody: `# ${convexDoc.title}\n\n${bodyOnly.redactedProposedBody}`,
                firstChangedHeading: bodyOnly.firstChangedHeading,
              }
            : null;
        })();

      if (!computed) return safeFile;
      const heading = file.firstChangedHeading ?? computed.firstChangedHeading ?? undefined;
      return {
        ...safeFile,
        redactedPreview: computed.redactedProposedBody,
        ...(heading ? { firstChangedHeading: heading } : {}),
      };
    }),
  );

  return {
    ...proposal,
    files: hydratedFiles,
  };
}
