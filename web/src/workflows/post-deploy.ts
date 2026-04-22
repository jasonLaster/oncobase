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

export async function postDeployWorkflow() {
  "use workflow";

  const deploy = process.env.VERCEL_DEPLOYMENT_ID ?? "local";
  console.log(`[post-deploy] Workflow started (deploy=${deploy})`);

  const runIds = await startChildWorkflows();

  console.log("[post-deploy] All child workflows launched:", runIds);
}

async function startChildWorkflows(): Promise<Record<string, string | null>> {
  "use step";
  const { start } = await import("workflow/api");
  const { buildDownloadCacheWorkflow } = await import("./build-download-cache");
  const { generateDescriptionsWorkflow } = await import("./generate-descriptions");
  const { ingestEmbeddingsWorkflow } = await import("./ingest-embeddings");

  const token =
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn("[post-deploy] Blob write token not set — download cache workflows skipped");
  }

  const [full, markdown, descriptions, embeddings] = await Promise.all([
    token ? start(buildDownloadCacheWorkflow, ["full"]) : Promise.resolve(null),
    token ? start(buildDownloadCacheWorkflow, ["markdown"]) : Promise.resolve(null),
    start(generateDescriptionsWorkflow, []),
    start(ingestEmbeddingsWorkflow),
  ]);

  return {
    downloadFull: full?.runId ?? null,
    downloadMarkdown: markdown?.runId ?? null,
    descriptions: descriptions.runId,
    embeddings: embeddings.runId,
  };
}
