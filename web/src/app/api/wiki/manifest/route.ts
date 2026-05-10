import crypto from "node:crypto";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import {
  buildCompactTreeFromManifest,
  type WikiManifest,
  type WikiManifestAsset,
  type WikiManifestPage,
  type WikiScope,
} from "@diana-tnbc/wiki-content";

const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
const PRIVATE_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=300";
const PAGE_SIZE = 1000;

type ManifestPageResult = {
  page: WikiManifestPage[];
  isDone: boolean;
  continueCursor: string;
};

type ManifestPageArgs = {
  cursor: string | null;
  numItems: number;
  includeSensitive?: boolean;
};

type AssetPathResult = {
  page: string[];
  isDone: boolean;
  continueCursor: string;
};

type PageWithContentResult = {
  page: Array<{
    slug: string;
    title: string;
    content: string;
    tags: string[];
    description?: string | null;
    contentHash?: string;
    sensitive?: boolean;
  }>;
  isDone: boolean;
  continueCursor: string;
};

function requestedScope(request: Request): WikiScope {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "session" ? "session" : "public";
}

function cacheHeaders(scope: WikiScope, etag: string) {
  return {
    "Cache-Control": scope === "public" ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    Vary: scope === "public" ? "Accept, x-site-slug" : "Accept, Cookie, x-site-slug",
    ETag: `W/"${etag}"`,
    "X-Wiki-Cache-Scope": scope,
  };
}

function hashJson(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

async function listManifestPages(
  siteData: ReturnType<typeof siteDataFromRequest>,
  includeSensitive: boolean,
) {
  const pages: WikiManifestPage[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let source: "manifest" | "content-fallback" = "manifest";
  let useContentFallback = false;
  while (!isDone) {
    const args: ManifestPageArgs = {
      cursor,
      numItems: PAGE_SIZE,
      ...(includeSensitive ? { includeSensitive: true } : {}),
    };
    const result = useContentFallback
      ? await listManifestPageFromContent(siteData, args)
      : await siteData.documents.listManifestPage(args)
          .catch(async (error) => {
            console.warn("[wiki manifest] Falling back to content metadata", error);
            source = "content-fallback";
            useContentFallback = true;
            return listManifestPageFromContent(siteData, args);
          }) as ManifestPageResult;
    pages.push(...result.page);
    isDone = result.isDone;
    cursor = result.continueCursor;
  }
  return { pages, source };
}

async function listManifestPageFromContent(
  siteData: ReturnType<typeof siteDataFromRequest>,
  args: ManifestPageArgs,
): Promise<ManifestPageResult> {
  const result = (await siteData.documents.listPageWithContent(args)) as PageWithContentResult;
  return {
    page: result.page.map((page) => ({
      slug: page.slug,
      title: page.title,
      tags: page.tags,
      description: page.description ?? null,
      contentHash: page.contentHash ?? null,
      sensitive: page.sensitive === true,
      size: page.content.length,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

async function listAssets(
  siteData: ReturnType<typeof siteDataFromRequest>,
  includeSensitive: boolean,
) {
  const listPaths = async (
    kind: WikiManifestAsset["kind"],
    fetchPage: (args: {
      cursor: string | null;
      numItems: number;
      includeSensitive?: boolean;
    }) => Promise<unknown>,
  ) => {
    const assets: WikiManifestAsset[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result = (await fetchPage({
        cursor,
        numItems: PAGE_SIZE,
        ...(includeSensitive ? { includeSensitive: true } : {}),
      })) as AssetPathResult;
      assets.push(
        ...result.page.map((path) => ({
          kind,
          path,
          contentHash: null,
          size: null,
        })),
      );
      isDone = result.isDone;
      cursor = result.continueCursor;
    }
    return assets;
  };

  const [pdfAssets, fileAssets] = await Promise.all([
    listPaths("pdf", (args) => siteData.documents.listPdfAssetPathsPage(args)),
    listPaths("file", (args) => siteData.documents.listFileAssetPathsPage(args)),
  ]);
  return [...pdfAssets, ...fileAssets];
}

export async function GET(request: Request) {
  const scope = requestedScope(request);
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
  let pageResult: Awaited<ReturnType<typeof listManifestPages>>;
  let assets: WikiManifestAsset[];
  try {
    [pageResult, assets] = await Promise.all([
      listManifestPages(siteData, includeSensitive),
      listAssets(siteData, includeSensitive),
    ]);
  } catch (error) {
    console.error("[wiki manifest] Reliable manifest metadata unavailable", error);
    return Response.json(
      { error: "Reliable wiki manifest metadata is unavailable" },
      { status: 503, headers: wikiApiHeaders(request, { "Cache-Control": "no-store" }) },
    );
  }
  const { pages, source } = pageResult;
  const compactTree = buildCompactTreeFromManifest(pages, assets);

  const manifestCore = {
    siteSlug: siteData.siteSlug,
    scope,
    compactTree,
    pages,
    assets,
  };
  const manifestHash = hashJson(manifestCore);
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch?.includes(manifestHash)) {
    return new Response(null, {
      status: 304,
      headers: wikiApiHeaders(request, cacheHeaders(scope, manifestHash)),
    });
  }

  const manifest: WikiManifest = {
    ...manifestCore,
    manifestHash,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(manifest, {
    headers: wikiApiHeaders(request, {
      ...cacheHeaders(scope, manifestHash),
      "X-Wiki-Manifest-Source": source,
    }),
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}
