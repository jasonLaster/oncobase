export async function startWikiMaintenanceWorkflows(
  source: "post-deploy" | "post-publish",
  siteSlug: string,
  prioritySlugs: string[] = [],
): Promise<Record<string, string | null>> {
  "use step";
  const { start } = await import("workflow/api");
  const { buildDownloadCacheWorkflow } = await import("./build-download-cache");
  const { generateDescriptionsWorkflow } = await import("./generate-descriptions");
  const { ingestEmbeddingsWorkflow } = await import("./ingest-embeddings");
  const { prewarmMarkdownRenderCacheWorkflow } = await import(
    "./prewarm-markdown-render-cache"
  );
  const { prewarmWikiPagesWorkflow } = await import("./prewarm-wiki-pages");

  const token =
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn(
      `[${source}] Blob write token not set - download cache workflows skipped`,
    );
  }

  const [full, markdown, descriptions, embeddings, renderPrewarm, prewarm] =
    await Promise.all([
      token
        ? start(buildDownloadCacheWorkflow, ["full", siteSlug])
        : Promise.resolve(null),
      token
        ? start(buildDownloadCacheWorkflow, ["markdown", siteSlug])
        : Promise.resolve(null),
      start(generateDescriptionsWorkflow, [siteSlug]),
      start(ingestEmbeddingsWorkflow, [siteSlug]),
      start(prewarmMarkdownRenderCacheWorkflow, [siteSlug, prioritySlugs]),
      start(prewarmWikiPagesWorkflow, [siteSlug, prioritySlugs]),
    ]);

  return {
    downloadFull: full?.runId ?? null,
    downloadMarkdown: markdown?.runId ?? null,
    descriptions: descriptions.runId,
    embeddings: embeddings.runId,
    renderPrewarm: renderPrewarm.runId,
    prewarm: prewarm.runId,
  };
}
