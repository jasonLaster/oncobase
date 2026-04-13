/**
 * POST /api/post-deploy
 *
 * Entry point for post-deployment automation. Starts the postDeployWorkflow
 * which fans out to all child workflows in parallel (download cache, AI
 * descriptions, semantic embeddings).
 *
 * Triggered by .github/workflows/post-deploy.yml after every successful
 * production deployment. Can also be called manually for a forced re-run.
 *
 * Secured via POST_DEPLOY_SECRET env var:
 *   https://diana-tnbc.com/api/post-deploy?secret=<POST_DEPLOY_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { postDeployWorkflow } from "@/workflows/post-deploy";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.POST_DEPLOY_SECRET;
  if (secret) {
    const provided = request.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      console.warn("[post-deploy] Unauthorized request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  console.log("[post-deploy] Starting post-deploy workflow");
  const run = await start(postDeployWorkflow);
  console.log(`[post-deploy] Workflow started: runId=${run.runId}`);

  return NextResponse.json({ started: true, runId: run.runId });
}
