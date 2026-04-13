/**
 * POST /api/warm-cache
 *
 * Triggers all post-deploy durable workflows in parallel:
 *   - buildDownloadCacheWorkflow("full")     — pre-build full zip → public Blob
 *   - buildDownloadCacheWorkflow("markdown") — pre-build markdown zip → public Blob
 *   - generateDescriptionsWorkflow           — AI descriptions for new pages
 *   - ingestEmbeddingsWorkflow               — OpenAI embeddings for semantic search
 *
 * Each workflow is independently retryable. Embedding and description workflows
 * run regardless of blob token availability.
 *
 * Secured via WARM_CACHE_SECRET env var:
 *   https://diana-tnbc.com/api/warm-cache?secret=<WARM_CACHE_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { buildDownloadCacheWorkflow } from "@/workflows/build-download-cache";
import { generateDescriptionsWorkflow } from "@/workflows/generate-descriptions";
import { ingestEmbeddingsWorkflow } from "@/workflows/ingest-embeddings";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.WARM_CACHE_SECRET;
  if (secret) {
    const provided = request.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      console.warn("[warm-cache] Unauthorized request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn("[warm-cache] BLOB_READ_WRITE_TOKEN not set — download cache workflows will be skipped");
  }

  console.log("[warm-cache] Triggering post-deploy workflows");

  const [fullRun, markdownRun, descriptionsRun, embeddingsRun] = await Promise.all([
    token ? start(buildDownloadCacheWorkflow, ["full"]) : Promise.resolve(null),
    token ? start(buildDownloadCacheWorkflow, ["markdown"]) : Promise.resolve(null),
    start(generateDescriptionsWorkflow, []),
    start(ingestEmbeddingsWorkflow),
  ]);

  const runs = {
    downloadFull: fullRun?.runId ?? null,
    downloadMarkdown: markdownRun?.runId ?? null,
    descriptions: descriptionsRun.runId,
    embeddings: embeddingsRun.runId,
  };

  console.log("[warm-cache] Workflows started:", runs);
  return NextResponse.json({ started: true, runs });
}
