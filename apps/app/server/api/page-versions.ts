// Page history for the reader: GET ?slug= lists a page's versions, and
// GET ?slug=&id= returns one past version's markdown. Access mirrors
// /api/page-copy: public pages answer from the public scope, restricted ones
// need a session that may read the slug. The Convex queries add the version
// rule (a restricted version stays hidden while the live page is public).
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { canUserAccessSlug, getSessionUser, redactText, withSiteSlug } from "../reader-access";

const PUBLIC_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  Vary: "Accept, Host",
  "X-Wiki-Cache-Scope": "public",
};
const SESSION_HEADERS = {
  "Cache-Control": "private, max-age=30",
  Vary: "Accept, Cookie, Host",
  "X-Wiki-Cache-Scope": "session",
};

function validSlug(slug: string) {
  return Boolean(slug) && !slug.startsWith("/") && !slug.split("/").some(part => part === "..");
}

const notFound = () => Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function handlePageVersionsRequest(request: Request, client: ConvexHttpClient, siteSlug: string) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const versionId = url.searchParams.get("id");
  if (!validSlug(slug) || (versionId !== null && !/^[a-z0-9]{1,64}$/i.test(versionId))) {
    return new Response("Invalid request", { status: 400 });
  }

  const read = async (includeSensitive: boolean) => versionId
    ? client.query(api.documents.getVersion, withSiteSlug(siteSlug, { slug, versionId, includeSensitive }))
    : client.query(api.documents.listVersions, withSiteSlug(siteSlug, { slug, includeSensitive }));

  let result = await read(false);
  let headers = PUBLIC_HEADERS;
  if (!result) {
    const user = await getSessionUser(request, client, siteSlug);
    if (!user) return notFound();
    result = await read(true);
    if (!result) return notFound();
    if (result.sensitive && !(await canUserAccessSlug(client, siteSlug, user, slug))) return notFound();
    headers = SESSION_HEADERS;
  }

  // Commit messages are free text from the vault's git history: redact them like bodies.
  const redact = (text: string | undefined) => text === undefined ? undefined : redactText(client, siteSlug, text);
  if ("content" in result) {
    return Response.json({
      ...result,
      content: await redactText(client, siteSlug, result.content),
      commitMessage: await redact(result.commitMessage),
    }, { headers });
  }
  const versions = await Promise.all(result.versions.map(async version => ({ ...version, commitMessage: await redact(version.commitMessage) })));
  return Response.json({ ...result, versions }, { headers });
}
