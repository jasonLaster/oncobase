import crypto from "node:crypto";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import type { WikiPageBatch, WikiPageRecord, WikiScope } from "@diana-tnbc/wiki-content";

const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
const PRIVATE_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=300";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type PageWithContentResult = {
  page: Array<{
    slug: string;
    title: string;
    content: string;
    tags: string[];
    contentHash?: string;
    sensitive?: boolean;
  }>;
  isDone: boolean;
  continueCursor: string;
};

function requestedScope(url: URL): WikiScope {
  return url.searchParams.get("scope") === "session" ? "session" : "public";
}

function parseLimit(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(raw)));
}

function parseSlugs(url: URL) {
  return (url.searchParams.get("slugs") ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, MAX_LIMIT);
}

function cacheHeaders(scope: WikiScope, etag: string) {
  return {
    "Cache-Control": scope === "public" ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    Vary: scope === "public" ? "Accept, x-site-slug" : "Accept, Cookie, x-site-slug",
    ETag: `W/"${etag}"`,
    "X-Wiki-Cache-Scope": scope,
  };
}

function pageRecord(page: PageWithContentResult["page"][number]): WikiPageRecord {
  return {
    slug: page.slug,
    title: page.title,
    content: page.content,
    tags: page.tags,
    contentHash: page.contentHash ?? null,
    sensitive: page.sensitive === true,
    size: page.content.length,
  };
}

function hashJson(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = requestedScope(url);
  const sessionUser =
    scope === "session" ? await getSessionUserFromRequest(request) : null;

  if (scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: wikiApiHeaders(request, { "Cache-Control": "private, no-store" }),
      },
    );
  }

  const includeSensitive = scope === "session" && Boolean(sessionUser);
  const siteData = siteDataFromRequest(request);
  const slugs = parseSlugs(url);
  let pages: WikiPageRecord[] = [];
  let isDone = true;
  let continueCursor: string | null = null;

  if (slugs.length > 0) {
    const records = await Promise.all(
      slugs.map(async (slug) => {
        const exact = await siteData.documents.getBySlug(
          includeSensitive ? { slug, includeSensitive: true } : { slug },
        );
        if (exact || slug.endsWith("/index")) return exact;
        return await siteData.documents.getBySlug(
          includeSensitive
            ? { slug: `${slug}/index`, includeSensitive: true }
            : { slug: `${slug}/index` },
        );
      }),
    );
    pages = records
      .filter((page): page is NonNullable<typeof page> => Boolean(page))
      .map((page) =>
        pageRecord({
          slug: page.slug,
          title: page.title,
          content: page.content,
          tags: page.tags,
          contentHash: page.contentHash,
          sensitive: page.sensitive,
        }),
      );
  } else {
    const limit = parseLimit(url);
    let cursor = url.searchParams.get("cursor");
    isDone = false;

    while (!isDone && pages.length < limit) {
      const result = (await siteData.documents.listPageWithContent({
        cursor,
        numItems: limit - pages.length,
        ...(includeSensitive ? { includeSensitive: true } : {}),
      })) as PageWithContentResult;

      pages.push(...result.page.map(pageRecord));
      isDone = result.isDone;
      cursor = result.continueCursor;

      if (!isDone && !cursor) {
        throw new Error("Wiki page pagination did not return a continuation cursor");
      }
    }

    continueCursor = isDone ? null : cursor;
  }

  const body: WikiPageBatch = {
    siteSlug: siteData.siteSlug,
    generatedAt: new Date().toISOString(),
    scope,
    pages,
    isDone,
    continueCursor,
  };
  const etag = hashJson({
    siteSlug: body.siteSlug,
    scope,
    slugs,
    pages: pages.map((page) => [page.slug, page.contentHash, page.size]),
    isDone,
    continueCursor,
  });

  if (request.headers.get("if-none-match")?.includes(etag)) {
    return new Response(null, {
      status: 304,
      headers: wikiApiHeaders(request, cacheHeaders(scope, etag)),
    });
  }

  return Response.json(body, {
    headers: wikiApiHeaders(request, cacheHeaders(scope, etag)),
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}
