import { afterEach, describe, expect, test } from "bun:test";
import type { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import { parseMarkdownDocument } from "@oncobase/wiki-content/markdown-document";
import { applyPiiRedactions } from "@oncobase/wiki-content/pii";
import schema from "../convex/schema";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "../convex/lib/serviceAuth";
import { handleMcpRequest } from "./api/mcp";
import { handleToolsRequest } from "./api/tools";
import { createViewerChatTools } from "./chat-route";
import { MemoryRepoAdapter, setTestRepoAdapter } from "./repo-adapter";
import { USER_SESSION_COOKIE, hashSessionToken } from "./user-auth";

const modules = {
  "../convex/wikiEdits.ts": () => import("../convex/wikiEdits"),
  "../convex/documents.ts": () => import("../convex/documents"),
  "../convex/sites.ts": () => import("../convex/sites"),
  "../convex/users.ts": () => import("../convex/users"),
  "../convex/access.ts": () => import("../convex/access"),
  "../convex/_generated/server.js": () => import("../convex/_generated/server"),
};

const RAW_PAGE = "---\ntitle: Overview\ntags: [care]\n---\n\n# Overview\n\nOriginal overview.\n";

async function createChatEditFixture() {
  const base = convexTest(schema, modules);
  const t = base.withIdentity({
    issuer: SERVICE_ISSUER,
    subject: SERVICE_SUBJECT,
    role: "backend-service",
  });
  const ownerToken = "owner-chat-token";
  const ownerTokenHash = hashSessionToken(ownerToken);
  const parsed = parseMarkdownDocument("wiki/overview", RAW_PAGE);

  await t.run(async (ctx) => {
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
      },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    const owner = await ctx.db.insert("users", {
      siteId,
      email: "owner@test.invalid",
      name: "Owner",
      passwordHash: "x",
      passwordSalt: "y",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userSessions", {
      siteId,
      userId: owner,
      tokenHash: ownerTokenHash,
      createdAt: 1,
      expiresAt: Date.now() + 86_400_000,
    });
    await ctx.db.insert("documents", {
      siteId,
      slug: parsed.slug,
      title: parsed.title,
      content: applyPiiRedactions(parsed.content, { patterns: [] }),
      rawContent: parsed.content,
      tags: parsed.tags,
      sensitiveInclude: parsed.sensitiveInclude,
      contentHash: parsed.hash,
      hashFunctionVersion: 3,
      sensitive: false,
      updatedAt: 1,
    });
  });

  const client = {
    query: (ref: never, args: never) => t.query(ref, args),
    mutation: (ref: never, args: never) => t.mutation(ref, args),
    action: (ref: never, args: never) => t.action(ref, args),
  } as unknown as ConvexHttpClient;

  return { client, ownerToken };
}

afterEach(() => {
  setTestRepoAdapter("diana", null);
});

describe("chat wiki-edit tool boundary", () => {
  test("never exposes propose_wiki_edit on createViewerChatTools, /api/tools, or /api/mcp even for site owner with repo configured", async () => {
    const { client, ownerToken } = await createChatEditFixture();
    setTestRepoAdapter("diana", new MemoryRepoAdapter({ "wiki/overview.md": RAW_PAGE }));

    const viewerTools = await createViewerChatTools({
      client,
      siteSlug: "diana",
      includeSensitive: true,
    });
    expect("propose_wiki_edit" in viewerTools).toBe(false);

    const toolsRes = await handleToolsRequest(
      new Request("https://wiki.test/api/tools", {
        method: "GET",
        headers: { cookie: `${USER_SESSION_COOKIE}=${ownerToken}` },
      }),
      client,
      "diana",
    );
    expect(toolsRes.status).toBe(200);
    const toolsBody = (await toolsRes.json()) as { tools: Array<{ name: string }> };
    expect(toolsBody.tools.map((tool) => tool.name)).not.toContain("propose_wiki_edit");

    const mcpRes = await handleMcpRequest(
      new Request("https://wiki.test/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${USER_SESSION_COOKIE}=${ownerToken}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      client,
      "diana",
    );
    expect(mcpRes.status).toBe(200);
    const mcpBody = (await mcpRes.json()) as { result: { tools: Array<{ name: string }> } };
    expect(mcpBody.result.tools.map((tool) => tool.name)).not.toContain("propose_wiki_edit");
  });
});
