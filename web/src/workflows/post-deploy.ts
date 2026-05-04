/**
 * Parent post-deploy workflow.
 *
 * Starts all post-deploy child workflows in parallel as a single durable
 * unit. Triggered by POST /api/post-deploy after every successful production
 * deployment (via .github/workflows/post-deploy.yml).
 *
 * Child workflows (each independently retryable):
 *   - buildDownloadCacheWorkflow("full")     — full wiki zip → public Blob
 *   - buildDownloadCacheWorkflow("markdown") — markdown-only zip → public Blob
 *   - generateDescriptionsWorkflow           — AI descriptions for new pages
 *   - ingestEmbeddingsWorkflow               — OpenAI embeddings for search
 *
 * start() cannot be called directly inside a workflow function — it must be
 * wrapped in a step. Each child workflow runs independently and is visible
 * as its own run in the Vercel Workflow dashboard.
 */

import { startWikiMaintenanceWorkflows } from "@/workflows/wiki-maintenance";

export async function postDeployWorkflow() {
  "use workflow";

  const deploy = process.env.VERCEL_DEPLOYMENT_ID ?? "local";
  console.log(`[post-deploy] Workflow started (deploy=${deploy})`);

  const runIds = await startWikiMaintenanceWorkflows("post-deploy", "diana");

  console.log("[post-deploy] All child workflows launched:", runIds);
}
