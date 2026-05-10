import crypto from "node:crypto";
import type {
  CompactFileNode,
  WikiManifest,
  WikiManifestAsset,
  WikiManifestPage,
  WikiPageBatch,
  WikiPageRecord,
  WikiScope,
  WikiSessionIdentity,
} from "./index";
import { isHiddenFileTreeAssetPath, isHiddenFileTreePath } from "./index";

const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
const PRIVATE_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=300";
const SESSION_CACHE_VERSION = "v1";
const MANIFEST_PAGE_SIZE = 100;
const MANIFEST_FALLBACK_PAGE_SIZE = 25;
const ASSET_PAGE_SIZE = 1000;
const MANIFEST_TIMEOUT_MS = 20_000;
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;

export type WikiApiSessionUser = {
  _id: string;
};

export type ManifestPageResult = {
  page: WikiManifestPage[];
  isDone: boolean;
  continueCursor: string | null;
};

export type PageWithContent = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  description?: string | null;
  contentHash?: string | null;
  sensitive?: boolean;
};

export type PageWithContentResult = {
  page: PageWithContent[];
  isDone: boolean;
  continueCursor: string | null;
};

export type AssetPathResult = {
  page: string[];
  isDone: boolean;
  continueCursor: string | null;
};

export type WikiApiDocumentsGateway = {
  listManifestPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<ManifestPageResult>;
  listPageWithContent(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<PageWithContentResult>;
  listPdfAssetPathsPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<AssetPathResult>;
  listFileAssetPathsPage(args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  }): Promise<AssetPathResult>;
  getBySlug(args: {
    slug: string;
    includeSensitive?: boolean;
  }): Promise<PageWithContent | null>;
};

export type WikiApiContext = {
  siteSlug: string;
  documents: WikiApiDocumentsGateway;
  getSessionUser(request: Request): Promise<WikiApiSessionUser | null>;
  decorateHeaders?: (headers: HeadersInit) => HeadersInit;
  logger?: Pick<Console, "error" | "warn">;
};

function requestedScope(request: Request): WikiScope {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "session" ? "session" : "public";
}

function hashJson(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function userHash(siteSlug: string, userId: string) {
  return crypto
    .createHash("sha256")
    .update(`${siteSlug}:${userId}:${SESSION_CACHE_VERSION}`)
    .digest("hex")
    .slice(0, 24);
}

function cacheHeaders(scope: WikiScope, etag: string) {
  return {
    "Cache-Control": scope === "public" ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    Vary: scope === "public" ? "Accept, x-site-slug" : "Accept, Cookie, x-site-slug",
    ETag: `W/"${etag}"`,
    "X-Wiki-Cache-Scope": scope,
  };
}

function decorate(context: WikiApiContext, headers: HeadersInit) {
  return context.decorateHeaders ? context.decorateHeaders(headers) : headers;
}

function pageRecord(page: PageWithContent): WikiPageRecord {
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

function manifestPageFromContent(page: PageWithContent): WikiManifestPage {
  return {
    slug: page.slug,
    title: page.title,
    tags: page.tags,
    description: page.description ?? null,
    contentHash: page.contentHash ?? null,
    sensitive: page.sensitive === true,
    size: page.content.length,
  };
}

type ApiFileNode = {
  name: string;
  slug: string;
  type: "directory" | "file" | "pdf";
  pdfPath?: string;
  children?: ApiFileNode[];
};

function splitSlug(slug: string) {
  return slug.split("/").filter(Boolean);
}

function insertFileNode(
  nodes: ApiFileNode[],
  segments: string[],
  type: "file" | "pdf",
  pdfPath?: string,
  parentSlug = "",
) {
  if (segments.length === 0) return;
  const [name, ...rest] = segments;
  const slug = parentSlug ? `${parentSlug}/${name}` : name;

  if (rest.length === 0) {
    const existing = nodes.find((node) => node.name === name);
    const nextNode: ApiFileNode =
      type === "pdf"
        ? { name, slug: pdfPath ?? slug, type: "pdf", pdfPath: pdfPath ?? slug }
        : { name, slug, type: "file" };

    if (!existing) {
      nodes.push(nextNode);
      return;
    }

    if (existing.type === "directory") {
      existing.children = existing.children ?? [];
      existing.children.unshift(nextNode);
      return;
    }

    Object.assign(existing, nextNode);
    return;
  }

  let directory = nodes.find(
    (node) => node.name === name && node.type === "directory",
  );
  if (!directory) {
    directory = { name, slug, type: "directory", children: [] };
    nodes.push(directory);
  }
  directory.children = directory.children ?? [];
  insertFileNode(directory.children, rest, type, pdfPath, slug);
}

function sortFileTree(nodes: ApiFileNode[]) {
  nodes.sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) sortFileTree(node.children ?? []);
}

function compactFileTree(nodes: ApiFileNode[], parentSlug = ""): CompactFileNode[] {
  return nodes.map((node) => {
    if (node.type === "directory") {
      return ["d", node.name, compactFileTree(node.children ?? [], node.slug)];
    }
    if (node.type === "pdf") {
      const expectedPath = `${parentSlug ? `${parentSlug}/` : ""}${node.name}.pdf`;
      return node.pdfPath === expectedPath ? ["p", node.name] : ["p", node.name, node.pdfPath];
    }
    const expectedSlug = `${parentSlug ? `${parentSlug}/` : ""}${node.name}`;
    return node.slug === expectedSlug ? ["f", node.name] : ["f", node.name, node.slug];
  });
}

function buildCompactTreeFromManifest(
  pages: Array<Pick<WikiManifestPage, "slug">>,
  assets: Array<Pick<WikiManifestAsset, "kind" | "path">>,
) {
  const root: ApiFileNode[] = [];
  for (const page of pages) {
    if (isHiddenFileTreePath(page.slug)) continue;
    insertFileNode(root, splitSlug(page.slug), "file");
  }
  for (const asset of assets) {
    if (isHiddenFileTreeAssetPath(asset.path)) continue;
    const segments = splitSlug(asset.path);
    if (segments.length === 0) continue;
    if (asset.kind === "pdf" || asset.path.toLowerCase().endsWith(".pdf")) {
      const name = segments[segments.length - 1]!.replace(/\.pdf$/i, "");
      insertFileNode(root, [...segments.slice(0, -1), name], "pdf", asset.path);
    } else {
      insertFileNode(root, segments, "file");
    }
  }
  sortFileTree(root);
  return compactFileTree(root);
}

async function requireSessionIfNeeded(
  request: Request,
  context: WikiApiContext,
  scope: WikiScope,
) {
  if (scope === "public") return null;
  return await context.getSessionUser(request);
}

async function listManifestPages(
  context: WikiApiContext,
  includeSensitive: boolean,
) {
  const pages: WikiManifestPage[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let source: "manifest" | "content-fallback" = "manifest";
  let useContentFallback = false;
  while (!isDone) {
    const args: {
      cursor: string | null;
      numItems: number;
      includeSensitive?: boolean;
    } = {
      cursor,
      numItems: useContentFallback ? MANIFEST_FALLBACK_PAGE_SIZE : MANIFEST_PAGE_SIZE,
      ...(includeSensitive ? { includeSensitive: true } : {}),
    };
    const result: ManifestPageResult = useContentFallback
      ? await listManifestPageFromContent(context, args)
      : await context.documents.listManifestPage(args).catch(async (error) => {
          context.logger?.warn("[wiki manifest] Falling back to content metadata", error);
          source = "content-fallback";
          useContentFallback = true;
          return listManifestPageFromContent(context, args);
        });
    pages.push(...result.page);
    isDone = result.isDone;
    cursor = result.continueCursor;
  }
  return { pages, source };
}

async function listManifestPageFromContent(
  context: WikiApiContext,
  args: {
    cursor: string | null;
    numItems: number;
    includeSensitive?: boolean;
  },
): Promise<ManifestPageResult> {
  const result = await context.documents.listPageWithContent(args);
  return {
    page: result.page.map(manifestPageFromContent),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

async function listAssets(
  context: WikiApiContext,
  includeSensitive: boolean,
) {
  const listPaths = async (
    kind: WikiManifestAsset["kind"],
    fetchPage: (args: {
      cursor: string | null;
      numItems: number;
      includeSensitive?: boolean;
    }) => Promise<AssetPathResult>,
  ) => {
    const assets: WikiManifestAsset[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result = await fetchPage({
        cursor,
        numItems: ASSET_PAGE_SIZE,
        ...(includeSensitive ? { includeSensitive: true } : {}),
      });
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
    listPaths("pdf", (args) => context.documents.listPdfAssetPathsPage(args)),
    listPaths("file", (args) => context.documents.listFileAssetPathsPage(args)),
  ]);
  return [...pdfAssets, ...fileAssets];
}

function parseLimit(url: URL) {
  const raw = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(raw)));
}

function parseSlugs(url: URL) {
  return (url.searchParams.get("slugs") ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, MAX_PAGE_LIMIT);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function createWikiSessionResponse(
  request: Request,
  context: WikiApiContext,
) {
  const scope = requestedScope(request);

  if (scope === "public") {
    const identity: WikiSessionIdentity = {
      siteSlug: context.siteSlug,
      scope,
      authenticated: false,
      cacheVersion: SESSION_CACHE_VERSION,
      cacheKey: `${context.siteSlug}:public:${SESSION_CACHE_VERSION}`,
      userHash: null,
    };
    return Response.json(identity, {
      headers: decorate(context, {
        "Cache-Control": "public, max-age=300",
        Vary: "Accept, x-site-slug",
        "X-Wiki-Cache-Scope": "public",
      }),
    });
  }

  const sessionUser = await context.getSessionUser(request);
  if (!sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: decorate(context, {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        }),
      },
    );
  }

  const hash = userHash(context.siteSlug, sessionUser._id);
  const identity: WikiSessionIdentity = {
    siteSlug: context.siteSlug,
    scope,
    authenticated: true,
    cacheVersion: SESSION_CACHE_VERSION,
    cacheKey: `${context.siteSlug}:session:${hash}:${SESSION_CACHE_VERSION}`,
    userHash: hash,
  };

  return Response.json(identity, {
    headers: decorate(context, {
      "Cache-Control": "private, no-store",
      Vary: "Accept, Cookie, x-site-slug",
      "X-Wiki-Cache-Scope": "session",
    }),
  });
}

export async function createWikiManifestResponse(
  request: Request,
  context: WikiApiContext,
) {
  const scope = requestedScope(request);
  const sessionUser = await requireSessionIfNeeded(request, context, scope);

  if (scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: decorate(context, { "Cache-Control": "private, no-store" }),
      },
    );
  }

  const includeSensitive = scope === "session" && Boolean(sessionUser);
  let pageResult: Awaited<ReturnType<typeof listManifestPages>>;
  let assets: WikiManifestAsset[];
  try {
    [pageResult, assets] = await withTimeout(
      Promise.all([
        listManifestPages(context, includeSensitive),
        listAssets(context, includeSensitive),
      ]),
      MANIFEST_TIMEOUT_MS,
      "Wiki manifest generation",
    );
  } catch (error) {
    context.logger?.error("[wiki manifest] Reliable manifest metadata unavailable", error);
    return Response.json(
      { error: "Reliable wiki manifest metadata is unavailable" },
      { status: 503, headers: decorate(context, { "Cache-Control": "no-store" }) },
    );
  }
  const { pages, source } = pageResult;
  const compactTree = buildCompactTreeFromManifest(pages, assets);

  const manifestCore = {
    siteSlug: context.siteSlug,
    scope,
    compactTree,
    pages,
    assets,
  };
  const manifestHash = hashJson(manifestCore);
  if (request.headers.get("if-none-match")?.includes(manifestHash)) {
    return new Response(null, {
      status: 304,
      headers: decorate(context, cacheHeaders(scope, manifestHash)),
    });
  }

  const manifest: WikiManifest = {
    ...manifestCore,
    manifestHash,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(manifest, {
    headers: decorate(context, {
      ...cacheHeaders(scope, manifestHash),
      "X-Wiki-Manifest-Source": source,
    }),
  });
}

export async function createWikiPagesResponse(
  request: Request,
  context: WikiApiContext,
) {
  const url = new URL(request.url);
  const scope = requestedScope(request);
  const sessionUser = await requireSessionIfNeeded(request, context, scope);

  if (scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: decorate(context, { "Cache-Control": "private, no-store" }),
      },
    );
  }

  const includeSensitive = scope === "session" && Boolean(sessionUser);
  const slugs = parseSlugs(url);
  let pages: WikiPageRecord[] = [];
  let isDone = true;
  let continueCursor: string | null = null;

  if (slugs.length > 0) {
    const records = await Promise.all(
      slugs.map(async (slug) => {
        const exact = await context.documents.getBySlug(
          includeSensitive ? { slug, includeSensitive: true } : { slug },
        );
        if (exact || slug.endsWith("/index")) return exact;
        return await context.documents.getBySlug(
          includeSensitive
            ? { slug: `${slug}/index`, includeSensitive: true }
            : { slug: `${slug}/index` },
        );
      }),
    );
    pages = records
      .filter((page): page is NonNullable<typeof page> => Boolean(page))
      .map(pageRecord);
  } else {
    const limit = parseLimit(url);
    let cursor = url.searchParams.get("cursor");
    isDone = false;

    while (!isDone && pages.length < limit) {
      const result = await context.documents.listPageWithContent({
        cursor,
        numItems: limit - pages.length,
        ...(includeSensitive ? { includeSensitive: true } : {}),
      });

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
    siteSlug: context.siteSlug,
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
      headers: decorate(context, cacheHeaders(scope, etag)),
    });
  }

  return Response.json(body, {
    headers: decorate(context, cacheHeaders(scope, etag)),
  });
}
