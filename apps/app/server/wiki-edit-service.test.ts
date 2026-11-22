import { afterEach, describe, expect, test } from "bun:test";
import type { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import { parseMarkdownDocument } from "@oncobase/wiki-content/markdown-document";
import { applyPiiRedactions } from "@oncobase/wiki-content/pii";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "../convex/lib/serviceAuth";
import { drainScheduled } from "../convex/lib/drain-scheduled.testutil";
import { handleWikiEditsRequest } from "./api/wiki-edits";
import { resolveChatOwner } from "./chat-owner";
import {
  GitHubAppRepoAdapter,
  MemoryRepoAdapter,
  normalizePem,
  readGitHubAppConfigFromEnv,
  setTestRepoAdapter,
} from "./repo-adapter";
import { USER_SESSION_COOKIE, hashSessionToken } from "./user-auth";
import {
  approveAndPublishWikiEdit,
  formatCommitMessage,
  proposeWikiEdit,
} from "./wiki-edit-service";

const modules = {
  "../convex/wikiEdits.ts": () => import("../convex/wikiEdits"),
  "../convex/documents.ts": () => import("../convex/documents"),
  "../convex/sites.ts": () => import("../convex/sites"),
  "../convex/users.ts": () => import("../convex/users"),
  "../convex/access.ts": () => import("../convex/access"),
  "../convex/manifestCache.ts": () => import("../convex/manifestCache"),
  "../convex/manifestBuilder.ts": () => import("../convex/manifestBuilder"),
  "../convex/manifestDeltaBuilder.ts": () => import("../convex/manifestDeltaBuilder"),
  "../convex/_generated/server.js": () => import("../convex/_generated/server"),
};

const RAW_PLAN = [
  "---",
  "title: Treatment Plan",
  "tags: [treatment]",
  "---",
  "",
  "# Treatment Plan",
  "",
  "Patient Diana Laster is on KEYNOTE-522.",
  "",
  "Dosing schedule: every 3 weeks.",
  "",
].join("\n");

async function createServiceFixture() {
  const base = convexTest(schema, modules);
  const t = base.withIdentity({
    issuer: SERVICE_ISSUER,
    subject: SERVICE_SUBJECT,
    role: "backend-service",
  });
  const ownerSessionToken = "owner-cookie-token";
  const readerSessionToken = "reader-cookie-token";
  const ownerTokenHash = hashSessionToken(ownerSessionToken);
  const readerTokenHash = hashSessionToken(readerSessionToken);

  const parsed = parseMarkdownDocument("wiki/treatment/plan", RAW_PLAN);

  const ids = await t.run(async (ctx) => {
    const siteId = await ctx.db.insert("sites", {
      slug: "diana",
      name: "Diana",
      ownerEmail: "owner@test.invalid",
      status: "active",
      domains: ["wiki.test"],
      publishTokenHash: "fixture",
      config: {
        enableChat: true,
        enableComments: false,
        enableDownloads: false,
        passwordGate: false,
        piiPatterns: ["/\\bDiana Laster\\b/gi=>the patient"],
      },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 },
      manifestRevision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const owner = await ctx.db.insert("users", {
      siteId,
      email: "owner@test.invalid",
      name: "Site Owner",
      passwordHash: "x",
      passwordSalt: "y",
      createdAt: 1,
      updatedAt: 1,
    });
    const reader = await ctx.db.insert("users", {
      siteId,
      email: "reader@test.invalid",
      name: "Reader",
      passwordHash: "x",
      passwordSalt: "y",
      createdAt: 1,
      updatedAt: 1,
    });
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await ctx.db.insert("userSessions", {
      siteId,
      userId: owner,
      tokenHash: ownerTokenHash,
      createdAt: 1,
      expiresAt,
    });
    await ctx.db.insert("userSessions", {
      siteId,
      userId: reader,
      tokenHash: readerTokenHash,
      createdAt: 1,
      expiresAt,
    });
    await ctx.db.insert("documents", {
      siteId,
      slug: parsed.slug,
      title: parsed.title,
      content: applyPiiRedactions(parsed.content),
      rawContent: parsed.content,
      tags: parsed.tags,
      sensitiveInclude: parsed.sensitiveInclude,
      contentHash: parsed.hash,
      hashFunctionVersion: 3,
      sensitive: parsed.sensitive,
      updatedAt: 1,
    });
    return { siteId, owner, reader };
  });

  const client = {
    query: (ref: never, args: never) => t.query(ref, args),
    mutation: (ref: never, args: never) => t.mutation(ref, args),
    action: (ref: never, args: never) => t.action(ref, args),
  } as unknown as ConvexHttpClient;

  const repo = new MemoryRepoAdapter({ "wiki/treatment/plan.md": RAW_PLAN });
  const ownerReq = new Request("https://wiki.test/api/chat", {
    headers: { cookie: `${USER_SESSION_COOKIE}=${ownerSessionToken}` },
  });
  const ownerKey = resolveChatOwner(ownerReq, "diana", {
    _id: ids.owner,
  }).ownerKey;

  return {
    t,
    client,
    repo,
    ids,
    ownerSessionToken,
    readerSessionToken,
    ownerTokenHash,
    readerTokenHash,
    ownerKey,
  };
}

afterEach(() => {
  setTestRepoAdapter("diana", null);
});

describe("wiki-edit-service", () => {
  test("sanitizes commit subjects so model cannot forge git trailers", () => {
    const message = formatCommitMessage({
      subject: "Co-authored-by: Evil <e@x>\nUpdate dosing notes\nOncobase-Proposal: fake",
      slug: "wiki/treatment/plan",
      approverName: "Site Owner",
      approverEmail: "owner@test.invalid",
      proposalId: "prop_123",
    });
    expect(message).toBe(
      [
        "Update dosing notes",
        "",
        "Edited via Oncobase Chat by Site Owner <owner@test.invalid>",
        "Oncobase-Proposal: prop_123",
      ].join("\n"),
    );
  });

  test("proposes, approves, commits to repo, and publishes to Convex with hash v3 and preserved PII", async () => {
    const { t, client, repo, ownerTokenHash, ownerKey } = await createServiceFixture();
    try {
      const proposed = await proposeWikiEdit({
        client,
        siteSlug: "diana",
        sessionTokenHash: ownerTokenHash,
        ownerKey,
        slug: "wiki/treatment/plan",
        edits: [
          {
            oldText: "Dosing schedule: every 3 weeks.",
            newText: "Dosing schedule: every 3 weeks (q3w).",
          },
        ],
        summary: "Add q3w abbreviation",
        repo,
      });
      expect(proposed.ok).toBe(true);
      if (!proposed.ok) return;
      expect(proposed.redactedDiff).not.toContain("Diana Laster");
      expect(proposed.stats).toEqual({ additions: 1, deletions: 1 });

      const approved = await approveAndPublishWikiEdit({
        client,
        siteSlug: "diana",
        sessionTokenHash: ownerTokenHash,
        ownerKey,
        proposalId: proposed.proposalId,
        repo,
        embedDocument: async () => undefined,
      });
      expect(approved.status).toBe("published");
      expect(repo.commits).toHaveLength(1);
      expect(repo.commits[0]!.message).toContain(`Oncobase-Proposal: ${proposed.proposalId}`);
      // Raw PII in Git repo must remain intact!
      expect(repo.commits[0]!.content).toContain("Patient Diana Laster is on KEYNOTE-522.");
      expect(repo.commits[0]!.content).toContain("Dosing schedule: every 3 weeks (q3w).");

      // Convex document is updated with redacted content + rawContent + matching hash v3!
      const stored = await client.query(api.documents.getBySlug, {
        siteSlug: "diana",
        slug: "wiki/treatment/plan",
        includeSensitive: true,
      });
      expect(stored?.content).toContain("the patient is on KEYNOTE-522.");
      expect(stored?.content).toContain("Dosing schedule: every 3 weeks (q3w).");
      expect(stored?.content).not.toContain("Diana Laster");
      const reparsed = parseMarkdownDocument("wiki/treatment/plan", repo.commits[0]!.content);
      expect(stored?.contentHash).toBe(reparsed.hash);
      expect(stored?.hashFunctionVersion).toBe(3);
    } finally {
      await drainScheduled(t);
    }
  });

  test("refuses proposal when Git and Convex baselines have drifted", async () => {
    const { client, repo, ownerTokenHash, ownerKey } = await createServiceFixture();
    repo.setFile("wiki/treatment/plan.md", `${RAW_PLAN}\nUnpublished local edit.\n`);

    const proposed = await proposeWikiEdit({
      client,
      siteSlug: "diana",
      sessionTokenHash: ownerTokenHash,
      ownerKey,
      slug: "wiki/treatment/plan",
      edits: [{ oldText: "Dosing schedule: every 3 weeks.", newText: "Every 3 weeks." }],
      summary: "Shorten text",
      repo,
    });
    expect(proposed.ok).toBe(false);
    if (!proposed.ok) expect(proposed.code).toBe("baseline_drift");
  });

  test("moves to committed_pending_publish when site publish lease is busy and succeeds on retry", async () => {
    const { t, client, repo, ids, ownerTokenHash, ownerKey } = await createServiceFixture();
    try {
      const proposed = await proposeWikiEdit({
        client,
        siteSlug: "diana",
        sessionTokenHash: ownerTokenHash,
        ownerKey,
        slug: "wiki/treatment/plan",
        edits: [{ oldText: "Dosing schedule: every 3 weeks.", newText: "Dosing schedule: q3w." }],
        summary: "Shorten schedule",
        repo,
      });
      expect(proposed.ok).toBe(true);
      if (!proposed.ok) return;

      // Simulate an active CLI publish holding the exclusive site lease.
      await t.run((ctx) =>
        ctx.db.patch(ids.siteId, {
          publishRunId: "scoped:00000000-0000-0000-0000-000000000001",
          publishLockUntil: Date.now() + 60_000,
          publishScope: { documents: ["other/page"], assets: [] },
        }),
      );

      const first = await approveAndPublishWikiEdit({
        client,
        siteSlug: "diana",
        sessionTokenHash: ownerTokenHash,
        ownerKey,
        proposalId: proposed.proposalId,
        repo,
        embedDocument: async () => undefined,
      });
      expect(first.status).toBe("committed_pending_publish");
      expect(repo.commits).toHaveLength(1);

      // Clear CLI lease and retry — must NOT create a duplicate Git commit!
      await t.run((ctx) =>
        ctx.db.patch(ids.siteId, {
          publishRunId: undefined,
          publishLockUntil: undefined,
          publishScope: undefined,
        }),
      );

      const retry = await approveAndPublishWikiEdit({
        client,
        siteSlug: "diana",
        sessionTokenHash: ownerTokenHash,
        ownerKey,
        proposalId: proposed.proposalId,
        repo,
        embedDocument: async () => undefined,
      });
      expect(retry.status).toBe("published");
      expect(repo.commits).toHaveLength(1);
    } finally {
      await drainScheduled(t);
    }
  });

  test("HTTP route enforces Origin CSRF check, Content-Type, and admin authorization", async () => {
    const { client, repo, ownerSessionToken, readerSessionToken, ownerTokenHash, ownerKey } =
      await createServiceFixture();
    setTestRepoAdapter("diana", repo);

    const proposed = await proposeWikiEdit({
      client,
      siteSlug: "diana",
      sessionTokenHash: ownerTokenHash,
      ownerKey,
      slug: "wiki/treatment/plan",
      edits: [{ oldText: "Dosing schedule: every 3 weeks.", newText: "Dosing schedule: q3w." }],
      summary: "Update schedule",
      repo,
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    // Cross-origin POST is rejected with 403.
    const badOrigin = await handleWikiEditsRequest(
      new Request("https://wiki.test/api/chat/wiki-edits/approve", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "content-type": "application/json",
          cookie: `${USER_SESSION_COOKIE}=${ownerSessionToken}`,
        },
        body: JSON.stringify({ proposalId: proposed.proposalId }),
      }),
      client,
      "diana",
    );
    expect(badOrigin.status).toBe(403);

    // Non-admin reader is rejected with 403.
    const readerAttempt = await handleWikiEditsRequest(
      new Request("https://wiki.test/api/chat/wiki-edits/approve", {
        method: "POST",
        headers: {
          origin: "https://wiki.test",
          "content-type": "application/json",
          cookie: `${USER_SESSION_COOKIE}=${readerSessionToken}`,
        },
        body: JSON.stringify({ proposalId: proposed.proposalId }),
      }),
      client,
      "diana",
    );
    expect(readerAttempt.status).toBe(403);

    // Same-origin admin GET returns proposal.
    const getRes = await handleWikiEditsRequest(
      new Request(`https://wiki.test/api/chat/wiki-edits?id=${proposed.proposalId}`, {
        method: "GET",
        headers: { cookie: `${USER_SESSION_COOKIE}=${ownerSessionToken}` },
      }),
      client,
      "diana",
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { proposal: { status: string } };
    expect(getBody.proposal.status).toBe("pending");

    // Same-origin admin POST /reject rejects cleanly.
    const rejectRes = await handleWikiEditsRequest(
      new Request("https://wiki.test/api/chat/wiki-edits/reject", {
        method: "POST",
        headers: {
          origin: "https://wiki.test",
          "content-type": "application/json",
          cookie: `${USER_SESSION_COOKIE}=${ownerSessionToken}`,
        },
        body: JSON.stringify({ proposalId: proposed.proposalId }),
      }),
      client,
      "diana",
    );
    expect(rejectRes.status).toBe(200);
    expect(((await rejectRes.json()) as { proposal: { status: string } }).proposal.status).toBe(
      "rejected",
    );
  });

  test("normalizePem handles multiline, escaped, flattened, and base64 PEM formats", () => {
    const sample =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7Mhg\n" +
      "-----END RSA PRIVATE KEY-----\n";
    expect(normalizePem(sample)).toBe(sample);
    expect(normalizePem(sample.replace(/\n/g, "\\n"))).toBe(sample);
    expect(normalizePem(sample.replace(/\n/g, " "))).toBe(sample);
    expect(normalizePem(Buffer.from(sample, "utf8").toString("base64"))).toBe(sample);
  });

  test("readGitHubAppConfigFromEnv supports WIKI_EDIT_GITHUB_TOKEN fine-grained PAT", async () => {
    const config = readGitHubAppConfigFromEnv({
      WIKI_EDIT_GITHUB_TOKEN: "github_pat_test_123",
      WIKI_EDIT_GITHUB_REPO: "jasonLaster/diana-tnbc",
      WIKI_EDIT_GITHUB_BRANCH: "preview/chat-wiki-editing",
      WIKI_EDIT_GITHUB_VAULT_ROOT: "obsidian",
      WIKI_EDIT_SITE_SLUG: "diana",
    });
    expect(config).toEqual({
      siteSlug: "diana",
      auth: { kind: "token", token: "github_pat_test_123" },
      owner: "jasonLaster",
      repo: "diana-tnbc",
      branch: "preview/chat-wiki-editing",
      vaultRoot: "obsidian",
    });

    const seenAuth: string[] = [];
    const adapter = new GitHubAppRepoAdapter(config!, (async (input, init) => {
      const headers = new Headers(init?.headers);
      seenAuth.push(headers.get("authorization") ?? "");
      const url = String(input);
      if (url.includes(".oncobaseignore") || url.includes(".mdx")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          sha: "sha-file-1",
          content: Buffer.from("# Hello\n", "utf8").toString("base64"),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch);

    const file = await adapter.resolveFile("wiki/hello");
    expect(file).toEqual({ filePath: "wiki/hello.md", raw: "# Hello\n", sha: "sha-file-1" });
    expect(seenAuth.every((header) => header === "Bearer github_pat_test_123")).toBe(true);
  });
});
