/**
 * POST /api/warm-cache
 *
 * Triggers durable workflows to pre-build both download zips and cache them to
 * Blob. Call this from a Vercel deploy webhook so the first user request after
 * a new deployment always hits the fast path.
 *
 * Secured via WARM_CACHE_SECRET env var. Set it in Vercel and include it in the
 * deploy webhook URL:
 *   https://diana-tnbc.com/api/warm-cache?secret=<WARM_CACHE_SECRET>
 *
 * Vercel deploy webhook setup:
 *   Project Settings → Git → Deploy Hooks → add hook pointing to this URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { buildDownloadCacheWorkflow } from "@/workflows/build-download-cache";
import { generateDescriptionsWorkflow } from "@/workflows/generate-descriptions";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.WARM_CACHE_SECRET;
  if (secret) {
    const provided = request.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      console.warn("[warm-cache] Unauthorized warm-cache request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn("[warm-cache] BLOB_READ_WRITE_TOKEN not set — skipping");
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  }

  console.log("[warm-cache] Triggering cache warm for full + markdown");

  const [fullRun, markdownRun, descriptionsRun] = await Promise.all([
    start(buildDownloadCacheWorkflow, ["full"]),
    start(buildDownloadCacheWorkflow, ["markdown"]),
    start(generateDescriptionsWorkflow, []),
  ]);

  console.log(`[warm-cache] Workflows started: full=${fullRun.runId} markdown=${markdownRun.runId} descriptions=${descriptionsRun.runId}`);

  return NextResponse.json({
    started: true,
    runs: { full: fullRun.runId, markdown: markdownRun.runId, descriptions: descriptionsRun.runId },
  });
}
