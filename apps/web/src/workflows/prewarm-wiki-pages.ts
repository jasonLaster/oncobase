import { isHiddenFileTreePath } from "@/lib/file-tree-paths";

const DEFAULT_PREWARM_BASE_URL = "https://diana-tnbc.com";
const DEFAULT_PREWARM_TOKEN = "diana";
const PREWARM_BATCH_SIZE = 12;
const PREWARM_TIMEOUT_MS = 30_000;
const PREWARM_API_PAGE_LIMIT = 100;
const ASSET_EXTENSION_RE = /\.(?:avif|gif|jpe?g|pdf|png|svg|webp)$/i;
const EMPTY_PREWARM_RESULT: PrewarmWikiPagesResult = {
  total: 0,
  warmed: 0,
  failed: 0,
  failures: [],
};

export interface PrewarmFailure {
  slug: string;
  status?: number;
  error: string;
}

export interface PrewarmWikiPagesResult {
  total: number;
  warmed: number;
  failed: number;
  failures: PrewarmFailure[];
}

interface PrewarmPageResult {
  slug: string;
  ok: boolean;
  status?: number;
  bytes?: number;
  error?: string;
}

interface PrewarmApiResult {
  endpoint: string;
  ok: boolean;
  status?: number;
  bytes?: number;
  error?: string;
}

interface PrewarmConfig {
  baseUrl: string;
  token: string | null;
  usingDefaultBaseUrl: boolean;
}

function shouldPrewarmSlug(slug: string) {
  if (!slug || slug.startsWith("sources/")) return false;
  if (isHiddenFileTreePath(slug)) return false;
  if (ASSET_EXTENSION_RE.test(slug)) return false;
  return slug === "index" || slug.startsWith("about/") || slug.startsWith("wiki/");
}

function routePathForSlug(slug: string) {
  return slug === "index" ? "/" : `/${slug}`;
}

function resolvePrewarmConfig(siteSlug: string): PrewarmConfig | null {
  const configuredBaseUrl = process.env.WIKI_PREWARM_BASE_URL?.trim();
  const configuredToken = process.env.WIKI_PREWARM_TOKEN?.trim();

  if (!configuredBaseUrl && process.env.VERCEL_ENV !== "production") {
    return null;
  }
  if (!configuredBaseUrl && siteSlug !== "diana") {
    return null;
  }

  return {
    baseUrl: configuredBaseUrl || DEFAULT_PREWARM_BASE_URL,
    token: configuredToken || (siteSlug === "diana" ? DEFAULT_PREWARM_TOKEN : null),
    usingDefaultBaseUrl: !configuredBaseUrl,
  };
}

function cookieFromSetCookieHeader(setCookie: string | null) {
  if (!setCookie) return null;
  return setCookie.split(";")[0] || null;
}

async function fetchWithTimeout(url: URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function apiPathForEndpoint(endpoint: string) {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

async function prewarmApiEndpoint(
  endpoint: string,
  cookie: string | null,
  baseUrl: string,
): Promise<PrewarmApiResult> {
  const url = new URL(apiPathForEndpoint(endpoint), baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      headers: {
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const text = await response.text();

    if (!response.ok) {
      return {
        endpoint,
        ok: false,
        status: response.status,
        bytes: text.length,
        error: `HTTP ${response.status}`,
      };
    }

    return {
      endpoint,
      ok: true,
      status: response.status,
      bytes: text.length,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function prewarmApiEndpoints(
  endpoints: string[],
  cookie: string | null,
  baseUrl: string,
): Promise<PrewarmApiResult[]> {
  "use step";
  return Promise.all(
    endpoints.map((endpoint) => prewarmApiEndpoint(endpoint, cookie, baseUrl)),
  );
}

async function prewarmWikiPagesApiBatches(
  cookie: string | null,
  baseUrl: string,
): Promise<PrewarmApiResult[]> {
  "use step";

  const results: PrewarmApiResult[] = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const params = new URLSearchParams({
      limit: String(PREWARM_API_PAGE_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);

    const endpoint = `/api/wiki/pages?${params.toString()}`;

    try {
      const url = new URL(apiPathForEndpoint(endpoint), baseUrl);
      const response = await fetchWithTimeout(url, {
        redirect: "follow",
        headers: {
          Accept: "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });
      const text = await response.text();

      if (!response.ok) {
        results.push({
          endpoint,
          ok: false,
          status: response.status,
          bytes: text.length,
          error: `HTTP ${response.status}`,
        });
        break;
      }

      results.push({
        endpoint,
        ok: true,
        status: response.status,
        bytes: text.length,
      });

      const body = JSON.parse(text) as {
        isDone?: boolean;
        continueCursor?: string | null;
      };
      isDone = body.isDone !== false;
      cursor = body.continueCursor ?? null;
      if (!isDone && !cursor) {
        results.push({
          endpoint,
          ok: false,
          error: "missing continueCursor for next /api/wiki/pages batch",
        });
        break;
      }
    } catch (error) {
      results.push({
        endpoint,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  return results;
}

function apiEndpointsForPrewarm() {
  return [
    "/api/pages",
    "/api/file-tree",
    "/api/file-tree?format=compact",
    "/api/wiki/manifest",
  ];
}

async function listPrewarmSlugs(siteSlug: string): Promise<string[]> {
  "use step";
  const { siteDataFromSlug } = await import("@/lib/site-data");
  const docs = await siteDataFromSlug(siteSlug).documents.list();
  return docs
    .map((doc: { slug: string }) => doc.slug)
    .filter(shouldPrewarmSlug)
    .sort((a, b) => {
      if (a === "index") return -1;
      if (b === "index") return 1;
      return a.localeCompare(b);
    });
}

async function createPrewarmSession(config: PrewarmConfig): Promise<string | null> {
  "use step";
  if (!config.token) return null;

  const loginUrl = new URL("/", config.baseUrl);
  loginUrl.searchParams.set("token", config.token);

  const response = await fetchWithTimeout(loginUrl, {
    redirect: "manual",
    headers: { Accept: "text/html" },
  });

  const cookie = cookieFromSetCookieHeader(response.headers.get("set-cookie"));
  if (!cookie) {
    console.warn(
      `[prewarm-wiki-pages] Auth cookie not returned status=${response.status}`,
    );
  }
  return cookie;
}

async function prewarmOne(
  slug: string,
  cookie: string | null,
  baseUrl: string,
): Promise<PrewarmPageResult> {
  const url = new URL(routePathForSlug(slug), baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const text = await response.text();
    const finalPath = new URL(response.url).pathname;

    if (!response.ok) {
      return {
        slug,
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
    }
    if (finalPath === "/login") {
      return {
        slug,
        ok: false,
        status: response.status,
        error: "redirected to login",
      };
    }
    if (text.includes('E{"digest"') || text.includes("$RX(")) {
      return {
        slug,
        ok: false,
        status: response.status,
        bytes: text.length,
        error: "response contained RSC error frame",
      };
    }
    if (text.length === 0) {
      return {
        slug,
        ok: false,
        status: response.status,
        bytes: 0,
        error: "empty response",
      };
    }

    return {
      slug,
      ok: true,
      status: response.status,
      bytes: text.length,
    };
  } catch (error) {
    return {
      slug,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function prewarmBatch(
  slugs: string[],
  cookie: string | null,
  baseUrl: string,
): Promise<PrewarmPageResult[]> {
  "use step";
  return Promise.all(slugs.map((slug) => prewarmOne(slug, cookie, baseUrl)));
}

export async function prewarmWikiPagesWorkflow(
  siteSlug = "diana",
): Promise<PrewarmWikiPagesResult> {
  "use workflow";

  const config = resolvePrewarmConfig(siteSlug);
  if (!config) {
    console.log(
      `[prewarm-wiki-pages] Skipping site=${siteSlug}: WIKI_PREWARM_BASE_URL is unset outside production`,
    );
    return EMPTY_PREWARM_RESULT;
  }

  console.log(
    `[prewarm-wiki-pages] Workflow started site=${siteSlug} baseUrl=${config.baseUrl} defaultBaseUrl=${config.usingDefaultBaseUrl}`,
  );
  const slugs = await listPrewarmSlugs(siteSlug);
  const cookie = await createPrewarmSession(config);

  const [metadataApiResults, pageApiResults] = await Promise.all([
    prewarmApiEndpoints(apiEndpointsForPrewarm(), cookie, config.baseUrl),
    prewarmWikiPagesApiBatches(cookie, config.baseUrl),
  ]);
  const apiResults = [...metadataApiResults, ...pageApiResults];
  const failedApiResults = apiResults.filter((result) => !result.ok);
  console.log(
    `[prewarm-wiki-pages] API endpoints warmed=${apiResults.length - failedApiResults.length}/${apiResults.length} failed=${failedApiResults.length}`,
  );
  for (const result of failedApiResults) {
    console.warn(
      `[prewarm-wiki-pages] API warm failed endpoint=${result.endpoint} status=${result.status ?? "n/a"} error=${result.error ?? "unknown"}`,
    );
  }

  const results: PrewarmPageResult[] = [];
  for (let i = 0; i < slugs.length; i += PREWARM_BATCH_SIZE) {
    const batch = slugs.slice(i, i + PREWARM_BATCH_SIZE);
    const batchResults = await prewarmBatch(batch, cookie, config.baseUrl);
    results.push(...batchResults);
    const warmed = results.filter((result) => result.ok).length;
    console.log(
      `[prewarm-wiki-pages] Batch ${Math.floor(i / PREWARM_BATCH_SIZE) + 1}/${Math.ceil(slugs.length / PREWARM_BATCH_SIZE)} warmed=${warmed}/${results.length}`,
    );
  }

  const failures = results
    .filter((result) => !result.ok)
    .map((result) => ({
      slug: result.slug,
      ...(result.status ? { status: result.status } : {}),
      error: result.error ?? "unknown failure",
    }));

  const summary = {
    total: slugs.length,
    warmed: results.length - failures.length,
    failed: failures.length,
    failures,
  };

  console.log(
    `[prewarm-wiki-pages] Complete warmed=${summary.warmed}/${summary.total} failed=${summary.failed}`,
  );

  return summary;
}
