import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { isEducationSlug } from "../education-access";
import { canUserAccessSlug, getSessionUser, redactText, withSiteSlug } from "../reader-access";

export function markdownFilename(slug: string) {
  const basename = slug.split("/").filter(Boolean).at(-1) || "index";
  return `${basename.replace(/[^a-z0-9._-]+/gi, "-")}.md`;
}

export async function handlePageCopyRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
  educationOnly = false,
) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  if (!slug || slug.startsWith("/") || slug.split("/").some((part: string) => part === "..")) {
    return new Response("Invalid slug", { status: 400 });
  }

  const publicPage = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug }),
  );
  if (publicPage && (!educationOnly || publicPage.sensitive === false && isEducationSlug(publicPage.slug))) {
    return new Response(await redactText(client, siteSlug, publicPage.content), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${markdownFilename(slug)}"`,
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        Vary: "Accept, Host",
        "X-Wiki-Cache-Scope": "public",
      },
    });
  }

  if (educationOnly || url.searchParams.get("scope") === "public") {
    return new Response("Not found", { status: 404 });
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) return new Response("Not found", { status: 404 });

  const privatePage = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug, includeSensitive: true }),
  );
  if (!privatePage) return new Response("Not found", { status: 404 });
  if (
    privatePage.sensitive === true &&
    !(await canUserAccessSlug(client, siteSlug, sessionUser, privatePage.slug))
  ) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(await redactText(client, siteSlug, privatePage.content), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${markdownFilename(slug)}"`,
      "Cache-Control": "private, max-age=60, stale-while-revalidate=3600",
      Vary: "Accept, Cookie, Host",
      "X-Wiki-Cache-Scope": "session",
    },
  });
}
