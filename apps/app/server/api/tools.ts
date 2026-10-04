import type { ConvexHttpClient } from "convex/browser";
import { readChatPageFromDocuments } from "@oncobase/wiki-content/chat-tools";
import { applyPiiRedactions } from "@oncobase/wiki-content/pii";
import { api } from "../../convex/_generated/api.js";
import { getDocumentsByTag, listDocuments } from "../document-listing";
import { type SessionUser, canUserAccessSlug, getPiiPatterns, getSessionUser, withSiteSlug } from "../reader-access";
import { filterAccessiblePages, filterPotentiallySensitivePages } from "./documents";

export async function readToolPage(
  client: ConvexHttpClient,
  siteSlug: string,
  slug: string,
  sessionUser: SessionUser | null,
) {
  return readChatPageFromDocuments(
    {
      getBySlug: async (args) => {
        const page = await client.query(api.documents.getBySlug, withSiteSlug(siteSlug, args));
        if (!page?.sensitive) return page;
        return (await canUserAccessSlug(client, siteSlug, sessionUser, page.slug))
          ? page
          : null;
      },
    },
    slug,
    { patterns: await getPiiPatterns(client, siteSlug) },
  );
}

export async function handleToolsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: { Allow: "POST" },
      },
    );
  }

  const { tool, args = {} } = (await request.json()) as {
    tool?: string;
    args?: Record<string, unknown>;
  };
  const sessionUser = await getSessionUser(request, client, siteSlug);
  const includeSensitive = Boolean(sessionUser);

  switch (tool) {
    case "search_wiki": {
      const query = String(args.query ?? "");
      const patterns = await getPiiPatterns(client, siteSlug);
      const results = await client.query(
        api.documents.search,
        withSiteSlug(siteSlug, { query, limit: 8, includeSensitive }),
      );
      const visibleResults = await filterPotentiallySensitivePages(
        client,
        siteSlug,
        sessionUser,
        results,
      );
      return Response.json(
        visibleResults.map((result) => ({
          ...result,
          title: applyPiiRedactions(result.title, { patterns }),
          excerpt: result.excerpt
            ? applyPiiRedactions(result.excerpt, { patterns })
            : result.excerpt,
        })),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    case "read_page": {
      return Response.json(await readToolPage(client, siteSlug, String(args.slug ?? ""), sessionUser), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        },
      });
    }
    case "list_pages": {
      const pages = await listDocuments(client, withSiteSlug(siteSlug, { includeSensitive }));
      return Response.json(await filterAccessiblePages(client, siteSlug, sessionUser, pages), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        },
      });
    }
    case "get_pages_by_tag": {
      const pages = await getDocumentsByTag(client, withSiteSlug(siteSlug, {
        tag: String(args.tag ?? ""),
        includeSensitive,
      }));
      return Response.json(
        await filterAccessiblePages(client, siteSlug, sessionUser, pages),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    case "list_tags": {
      const pages = await listDocuments(client, withSiteSlug(siteSlug, { includeSensitive }));
      const visiblePages = await filterAccessiblePages(client, siteSlug, sessionUser, pages);
      return Response.json(
        Array.from(new Set(visiblePages.flatMap((page) => page.tags))).sort(),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
  }
}
