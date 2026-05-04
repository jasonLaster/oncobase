import { startWikiMaintenanceWorkflows } from "@/workflows/wiki-maintenance";

/**
 * Parent post-publish workflow.
 *
 * Runs after the publisher finishes mutating Convex. The publish route handles
 * cache invalidation synchronously; this workflow rebuilds durable artifacts in
 * the background: download zips, generated descriptions, and embeddings.
 */
export async function postPublishWorkflow(siteSlug = "diana") {
  "use workflow";

  console.log(`[post-publish] Workflow started (site=${siteSlug})`);

  const runIds = await startWikiMaintenanceWorkflows("post-publish", siteSlug);

  console.log("[post-publish] All child workflows launched:", runIds);
}
