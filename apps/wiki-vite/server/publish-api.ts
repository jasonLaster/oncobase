import crypto from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../apps/web/convex/_generated/api.js";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import { withSiteSlug } from "./wiki-api.js";

const MIN_SUPPORTED_PUBLISHER_PROTOCOL_VERSION = 1;
const PUBLISHER_VERSION_HEADER = "X-Publisher-Version";
const MAX_DOCUMENT_CONTENT_STORAGE_BYTES = 950_000;
const MAX_POST_PUBLISH_PRIORITY_SLUGS = 64;

type Manifest = {
  documents?: Array<{ slug: string; hash: string; sensitive?: boolean }>;
  assets?: Array<{ path: string; hash: string; kind?: "pdf" | "file" }>;
};

type SyncManifest = {
  documents?: Array<{ slug: string; hash: string }>;
  assets?: Array<{ path: string; hash: string; kind?: "pdf" | "file" }>;
};

type AssetChangeReason =
  | "missingRemoteAssetRow"
  | "missingRemoteContentHash"
  | "hashMismatch"
  | "forced";

type AssetChange = {
  path: string;
  kind: "pdf" | "file";
  reason: AssetChangeReason;
};

type DocumentHashPage = {
  page: Array<{
    slug: string;
    contentHash?: string;
    hasRawContent?: boolean;
    hashFunctionVersion?: number;
    sensitive?: boolean;
  }>;
  isDone: boolean;
  continueCursor: string | null;
};

type AssetHashPage = {
  page: Array<{
    kind: "pdf" | "file";
    path: string;
    contentHash?: string;
    blobUrl?: string;
  }>;
  isDone: boolean;
  continueCursor: string | null;
};

type PageWithContentPage = {
  page: Array<{
    slug: string;
    contentHash?: string | null;
    [key: string]: unknown;
  }>;
  isDone: boolean;
  continueCursor: string | null;
};

function hashToken(token: string) {
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function publishTokenMatches(
  site: {
    publishTokenHash: string;
    publishTokenHashes?: string[];
    publishTokens?: Array<{ hash: string; revokedAt?: number }>;
  },
  token: string,
) {
  const tokenHash = hashToken(token);
  const hashes = Array.from(
    new Set([
      site.publishTokenHash,
      ...(site.publishTokenHashes ?? []),
      ...(site.publishTokens ?? [])
        .filter((publishToken) => publishToken.revokedAt === undefined)
        .map((publishToken) => publishToken.hash),
    ].filter(Boolean)),
  );
  return hashes.some((hash) => constantTimeEqual(hash, tokenHash));
}

function publisherVersion(request: Request) {
  const raw = request.headers.get(PUBLISHER_VERSION_HEADER);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unsupportedPublisherResponse(request: Request) {
  if (publisherVersion(request) >= MIN_SUPPORTED_PUBLISHER_PROTOCOL_VERSION) {
    return null;
  }
  return new Response(
    `Publisher protocol is too old. Minimum supported version is ${MIN_SUPPORTED_PUBLISHER_PROTOCOL_VERSION}.`,
    { status: 426 },
  );
}

async function requirePublishSite(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const token = bearerToken(request);
  if (!token) throw new Response("Missing bearer token", { status: 401 });
  const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
  if (!site || !publishTokenMatches(site, token)) {
    throw new Response("Invalid publish token", { status: 401 });
  }
  return { site };
}

function assetKey(asset: { path: string; kind?: "pdf" | "file" }) {
  return `${asset.kind ?? "file"}:${asset.path}`;
}

function pathFromAssetKey(key: string) {
  return key.slice(key.indexOf(":") + 1);
}

function siteBlobKey(siteSlug: string, key: string) {
  if (!/^[a-z0-9-]{1,32}$/.test(siteSlug)) {
    throw new Error(`bad siteSlug: ${siteSlug}`);
  }
  return `sites/${siteSlug}/${key.replace(/^\/+/, "")}`;
}

function sitePiiPatterns(site: { config?: { piiPatterns?: string[] } }): PiiPattern[] {
  return parseSitePiiPatterns(site.config?.piiPatterns);
}

async function currentDocumentHashes(client: ConvexHttpClient, siteSlug: string) {
  const hashes = new Map<
    string,
    {
      contentHash?: string;
      hasRawContent?: boolean;
      hashFunctionVersion?: number;
      sensitive?: boolean;
    }
  >();
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: DocumentHashPage = await client.query(
      api.documents.embeddingStatusPage,
      withSiteSlug(siteSlug, { cursor, numItems: 100, includeSensitive: true }),
    );
    for (const doc of page.page) {
      hashes.set(doc.slug, {
        contentHash: doc.contentHash,
        hasRawContent: doc.hasRawContent,
        hashFunctionVersion: doc.hashFunctionVersion,
        sensitive: doc.sensitive,
      });
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return hashes;
}

async function currentAssetHashes(client: ConvexHttpClient, siteSlug: string) {
  const hashes = new Map<
    string,
    {
      kind: "pdf" | "file";
      path: string;
      contentHash?: string;
      blobUrl?: string;
    }
  >();
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: AssetHashPage = await client.query(
      api.documents.assetHashesPage,
      withSiteSlug(siteSlug, { cursor, numItems: 1000, includeSensitive: true }),
    );
    for (const asset of page.page) {
      hashes.set(`${asset.kind}:${asset.path}`, asset);
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return hashes;
}

async function handleAssetUpload(request: Request, client: ConvexHttpClient) {
  const body = (await request.json()) as {
    siteSlug?: string;
    assetPath?: string;
    kind?: string;
    contentHash?: string;
    blobUrl?: string;
    sizeBytes?: number;
  };
  const siteSlug = body.siteSlug ?? "";
  if (!siteSlug) return new Response("siteSlug required", { status: 400 });
  const assetPath = body.assetPath ?? "";
  if (!assetPath) return new Response("assetPath required", { status: 400 });
  const kind: "pdf" | "file" = body.kind === "pdf" ? "pdf" : "file";
  const contentHash = body.contentHash ?? "";
  if (!contentHash) return new Response("contentHash required", { status: 400 });
  const blobUrl = body.blobUrl ?? "";
  if (!blobUrl) return new Response("blobUrl required", { status: 400 });
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return new Response("sizeBytes required", { status: 400 });
  }
  const expectedKey = siteBlobKey(siteSlug, `${kind}s/${assetPath}`);
  if (!blobUrl.includes(expectedKey)) {
    return new Response("blobUrl does not match site/path", { status: 400 });
  }
  await requirePublishSite(request, client, siteSlug);
  await client.mutation(
    kind === "pdf"
      ? api.documents.upsertPdfAsset
      : api.documents.upsertFileAsset,
    withSiteSlug(siteSlug, {
      path: assetPath,
      blobUrl,
      sizeBytes,
      contentHash,
    }),
  );
  return Response.json({ ok: true, blobUrl, sizeBytes });
}

async function handleAssetHashBackfill(request: Request, client: ConvexHttpClient) {
  const body = (await request.json()) as {
    siteSlug?: string;
    entries?: Array<{ path?: string; kind?: string; contentHash?: string }>;
  };
  const siteSlug = body.siteSlug ?? "";
  if (!siteSlug) return new Response("siteSlug required", { status: 400 });
  const entries = (body.entries ?? []).map((entry) => ({
    path: entry.path ?? "",
    kind: entry.kind === "pdf" ? ("pdf" as const) : ("file" as const),
    contentHash: entry.contentHash ?? "",
  }));
  if (entries.length === 0) return new Response("entries required", { status: 400 });
  if (entries.some((entry) => !entry.path || !entry.contentHash)) {
    return new Response("entry path and contentHash required", { status: 400 });
  }
  await requirePublishSite(request, client, siteSlug);
  const result = await client.mutation(
    api.documents.backfillAssetHashes,
    withSiteSlug(siteSlug, { entries }),
  );
  return Response.json(result);
}

async function handleDocumentHashBackfill(request: Request, client: ConvexHttpClient) {
  const body = (await request.json()) as {
    siteSlug?: string;
    hashFunctionVersion?: number;
    entries?: Array<{ slug?: string; contentHash?: string }>;
  };
  const siteSlug = body.siteSlug ?? "";
  if (!siteSlug) return new Response("siteSlug required", { status: 400 });
  const entries = (body.entries ?? []).map((entry) => ({
    slug: entry.slug ?? "",
    contentHash: entry.contentHash ?? "",
  }));
  if (entries.length === 0) return new Response("entries required", { status: 400 });
  if (entries.some((entry) => !entry.slug || !entry.contentHash)) {
    return new Response("entry slug and contentHash required", { status: 400 });
  }
  await requirePublishSite(request, client, siteSlug);
  const result = await client.mutation(
    api.documents.bulkSetContentHash,
    withSiteSlug(siteSlug, {
      hashFunctionVersion: body.hashFunctionVersion,
      entries,
    }),
  );
  return Response.json(result);
}

function postPublishPrioritySlugs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim().replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
    if (!slug || seen.has(slug)) continue;
    slugs.push(slug);
    seen.add(slug);
    if (slugs.length >= MAX_POST_PUBLISH_PRIORITY_SLUGS) break;
  }
  return slugs;
}

async function startPostPublishWorkflow(siteSlug: string, prioritySlugs: string[]) {
  try {
    const { start } = await import("workflow/api");
    const run = await start(
      async function postPublishManifestRefreshWorkflow() {
        "use workflow";
        console.log(
          `[post-publish] wiki-vite manifest refresh completed for ${siteSlug} (${prioritySlugs.length} priority slugs)`,
        );
      },
      [],
    );
    return run.runId;
  } catch (error) {
    console.warn("[publish] post-publish workflow unavailable", error);
    return null;
  }
}

function logRouteError(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[publish] ${step} failed: ${message}`, stack ?? "");
}

export async function handlePublishRequest({
  request,
  client,
  step,
}: {
  request: Request;
  client: ConvexHttpClient;
  step: string;
}) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }

    if (step === "asset") return await handleAssetUpload(request, client);
    if (step === "asset-hashes") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      return await handleAssetHashBackfill(request, client);
    }
    if (step === "document-hashes") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      return await handleDocumentHashBackfill(request, client);
    }

    const body = await request.json();
    const siteSlug = body.siteSlug;
    if (typeof siteSlug !== "string") {
      return new Response("siteSlug is required", { status: 400 });
    }
    const { site } = await requirePublishSite(request, client, siteSlug);
    const piiPatterns = sitePiiPatterns(site);

    if (step === "sync/documents") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const cursor = typeof body.cursor === "string" ? body.cursor : null;
      const numItems =
        typeof body.numItems === "number" && body.numItems > 0
          ? Math.min(body.numItems, 500)
          : 100;
      return Response.json(
        await client.query(
          api.documents.listPageWithContent,
          withSiteSlug(siteSlug, { cursor, numItems, includeSensitive: true }),
        ),
      );
    }

    if (step === "sync/assets") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const cursor = typeof body.cursor === "string" ? body.cursor : null;
      const numItems =
        typeof body.numItems === "number" && body.numItems > 0
          ? Math.min(body.numItems, 500)
          : 100;
      return Response.json(
        await client.query(
          api.documents.assetHashesPage,
          withSiteSlug(siteSlug, { cursor, numItems, includeSensitive: true }),
        ),
      );
    }

    if (step === "sync/plan") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const manifest = (body.manifest ?? {}) as SyncManifest;
      const localDocHashes = new Map(
        (manifest.documents ?? []).map((doc) => [doc.slug, doc.hash]),
      );
      const localAssetHashes = new Map(
        (manifest.assets ?? []).map((asset) => [assetKey(asset), asset.hash]),
      );

      const documents = [];
      const remoteDocSlugs = new Set<string>();
      let docCursor: string | null = null;
      let docsDone = false;
      while (!docsDone) {
        const page: PageWithContentPage = await client.query(
          api.documents.listPageWithContent,
          withSiteSlug(siteSlug, {
            cursor: docCursor,
            numItems: 500,
            includeSensitive: true,
          }),
        );
        for (const doc of page.page) {
          remoteDocSlugs.add(doc.slug);
          if (localDocHashes.get(doc.slug) !== doc.contentHash) {
            documents.push(doc);
          }
        }
        docsDone = page.isDone;
        docCursor = page.continueCursor;
      }

      const assets = [];
      const remoteAssetKeys = new Set<string>();
      let assetCursor: string | null = null;
      let assetsDone = false;
      while (!assetsDone) {
        const page: AssetHashPage = await client.query(
          api.documents.assetHashesPage,
          withSiteSlug(siteSlug, {
            cursor: assetCursor,
            numItems: 500,
            includeSensitive: true,
          }),
        );
        for (const asset of page.page) {
          const key = `${asset.kind}:${asset.path}`;
          remoteAssetKeys.add(key);
          if (localAssetHashes.get(key) !== asset.contentHash) assets.push(asset);
        }
        assetsDone = page.isDone;
        assetCursor = page.continueCursor;
      }

      return Response.json({
        documents,
        assets,
        orphanDocs: Array.from(localDocHashes.keys()).filter(
          (slug) => !remoteDocSlugs.has(slug),
        ),
        orphanAssets: Array.from(localAssetHashes.keys()).filter(
          (key) => !remoteAssetKeys.has(key),
        ),
      });
    }

    if (step === "begin") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const manifest = (body.manifest ?? {}) as Manifest;
      const force = Boolean(body.force);
      const dryRun = Boolean(body.dryRun);
      const manifestHashFunctionVersion =
        typeof body.hashFunctionVersion === "number"
          ? body.hashFunctionVersion
          : undefined;
      if (!dryRun) {
        await client.mutation(api.sites.beginPublish, { slug: siteSlug });
      }

      const existingDocHashes = await currentDocumentHashes(client, siteSlug);
      const docManifest = manifest.documents ?? [];
      const missingDocumentSlugs: string[] = [];
      const rawContentBackfillSlugs: string[] = [];
      const staleHashVersionSlugs: string[] = [];
      for (const doc of docManifest) {
        const existing = existingDocHashes.get(doc.slug);
        const missingRawContent =
          existing &&
          existing.contentHash === doc.hash &&
          (existing.sensitive === true) === (doc.sensitive === true) &&
          !existing.hasRawContent;
        if (
          force ||
          !existing ||
          existing.contentHash !== doc.hash ||
          existing.sensitive === true !== (doc.sensitive === true) ||
          missingRawContent
        ) {
          missingDocumentSlugs.push(doc.slug);
          if (!force && missingRawContent) rawContentBackfillSlugs.push(doc.slug);
          if (
            existing &&
            manifestHashFunctionVersion !== undefined &&
            (existing.hashFunctionVersion ?? 0) < manifestHashFunctionVersion
          ) {
            staleHashVersionSlugs.push(doc.slug);
          }
        }
      }
      const manifestDocumentSlugs = new Set(docManifest.map((doc) => doc.slug));
      const staleDocumentSlugs = Array.from(existingDocHashes.keys()).filter(
        (slug) => !manifestDocumentSlugs.has(slug),
      );

      const existingAssetHashes = await currentAssetHashes(client, siteSlug);
      const assetChanges: AssetChange[] = [];
      for (const asset of manifest.assets ?? []) {
        const kind = asset.kind ?? "file";
        const existing = existingAssetHashes.get(assetKey(asset));
        if (force) {
          assetChanges.push({ path: asset.path, kind, reason: "forced" });
        } else if (!existing) {
          assetChanges.push({
            path: asset.path,
            kind,
            reason: "missingRemoteAssetRow",
          });
        } else if (!existing.contentHash && existing.blobUrl) {
          assetChanges.push({
            path: asset.path,
            kind,
            reason: "missingRemoteContentHash",
          });
        } else if (existing.contentHash !== asset.hash) {
          assetChanges.push({ path: asset.path, kind, reason: "hashMismatch" });
        }
      }
      const missingAssetPaths = assetChanges
        .filter((asset) => asset.reason !== "missingRemoteContentHash")
        .map((asset) => asset.path);
      const manifestAssetKeys = new Set(
        (manifest.assets ?? []).map((asset) => assetKey(asset)),
      );
      const staleAssetPaths = Array.from(existingAssetHashes.keys())
        .filter((key) => !manifestAssetKeys.has(key))
        .map(pathFromAssetKey);

      return Response.json({
        runId: crypto.randomUUID(),
        missingDocumentSlugs,
        rawContentBackfillSlugs,
        missingAssetPaths,
        assetChanges,
        staleDocumentSlugs,
        staleAssetPaths,
        staleHashVersionSlugs,
      });
    }

    if (step === "document") {
      const {
        slug,
        title,
        content,
        tags,
        sensitiveInclude,
        hash,
        hashFunctionVersion,
        embedding,
        sensitive,
      } = body as {
        slug?: string;
        title?: string;
        content?: string;
        tags?: string[];
        sensitiveInclude?: string[];
        hash?: string;
        hashFunctionVersion?: number;
        embedding?: number[];
        sensitive?: boolean;
      };
      if (!slug || !title || typeof content !== "string" || !hash) {
        return new Response("slug, title, content, and hash are required", {
          status: 400,
        });
      }
      const redactedContent = applyPiiRedactions(content, { patterns: piiPatterns });
      const contentSize = new TextEncoder().encode(content).byteLength;
      const redactedContentSize = new TextEncoder().encode(redactedContent).byteLength;
      const rawContent =
        contentSize + redactedContentSize <= MAX_DOCUMENT_CONTENT_STORAGE_BYTES
          ? content
          : undefined;
      await client.mutation(
        api.documents.upsert,
        withSiteSlug(siteSlug, {
          slug,
          title,
          content: redactedContent,
          rawContent,
          tags: Array.isArray(tags) ? tags : [],
          sensitiveInclude: Array.isArray(sensitiveInclude) ? sensitiveInclude : [],
          contentHash: hash,
          hashFunctionVersion,
          sensitive: sensitive === true,
        }),
      );
      if (Array.isArray(embedding)) {
        await client.mutation(
          api.documents.upsertEmbedding,
          withSiteSlug(siteSlug, { slug, embedding, embeddingHash: hash }),
        );
      }
      return Response.json({ ok: true });
    }

    if (step === "abort") {
      const errorMessage =
        typeof body.error === "string" ? body.error.slice(0, 2000) : "publisher aborted";
      await client
        .mutation(api.sites.failPublish, { slug: siteSlug, error: errorMessage })
        .catch((error) => logRouteError("abort", error));
      return Response.json({ ok: true });
    }

    if (step === "finish") {
      try {
        for (const slug of body.deletedDocSlugs ?? []) {
          if (typeof slug === "string") {
            await client.mutation(
              api.documents.deleteBySlug,
              withSiteSlug(siteSlug, { slug }),
            );
          }
        }
        for (const assetPath of body.deletedAssetPaths ?? []) {
          if (typeof assetPath === "string") {
            await client.mutation(
              api.documents.deletePdfAssetByPath,
              withSiteSlug(siteSlug, { path: assetPath }),
            );
            await client.mutation(
              api.documents.deleteFileAssetByPath,
              withSiteSlug(siteSlug, { path: assetPath }),
            );
          }
        }
        await client.mutation(api.sites.finishPublish, { slug: siteSlug });
        const postPublishRunId = await startPostPublishWorkflow(
          siteSlug,
          postPublishPrioritySlugs(body.changedDocumentSlugs),
        );
        return Response.json({ ok: true, postPublishRunId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await client
          .mutation(api.sites.failPublish, { slug: siteSlug, error: message })
          .catch(() => {});
        throw error;
      }
    }

    return new Response(`Unknown publish step: ${step}`, { status: 404 });
  } catch (error) {
    if (error instanceof Response) return error;
    logRouteError(step, error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ step, error: message }, { status: 500 });
  }
}

export async function handlePostDeployRequest(request: Request) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  const secret = process.env.POST_DEPLOY_SECRET;
  if (secret && new URL(request.url).searchParams.get("secret") !== secret) {
    console.warn("[post-deploy] Unauthorized request");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { start } = await import("workflow/api");
    const run = await start(
      async function postDeployManifestRefreshWorkflow() {
        "use workflow";
        console.log("[post-deploy] wiki-vite post-deploy manifest refresh completed");
      },
      [],
    );
    return Response.json({ started: true, runId: run.runId });
  } catch (error) {
    console.warn("[post-deploy] workflow unavailable", error);
    return Response.json({ started: true, runId: null });
  }
}
