import crypto from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import { parseWikiManifest } from "@oncobase/wiki-content";
import { withSiteSlug } from "./wiki-api.js";
import { siteBlobKey } from "./blob";
import { traceBackendPhase } from "./backend-tracing";
import { assertPublishRun, OWNED_RUN_PREFIX } from "../convex/lib/publishRun";

const MIN_SUPPORTED_PUBLISHER_PROTOCOL_VERSION = 1;
const PUBLISHER_VERSION_HEADER = "X-Publisher-Version";
const MAX_DOCUMENT_CONTENT_STORAGE_BYTES = 950_000;

type Manifest = {
  documents?: Array<{ slug: string; hash: string; sensitive?: boolean }>;
  assets?: Array<{ path: string; hash: string; kind?: "pdf" | "file"; visibilityHash?: string }>;
};

type SyncManifest = {
  documents?: Array<{ slug: string; hash: string }>;
  assets?: Array<{ path: string; hash: string; kind?: "pdf" | "file" }>;
};

type AssetChangeReason =
  | "missingRemoteAssetRow"
  | "missingRemoteContentHash"
  | "missingRemoteBlob"
  | "unverifiedRemoteBytes"
  | "hashMismatch"
  | "metadataMismatch"
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
  const site = await traceBackendPhase("publish.auth", () => client.query(api.sites.getBySlug, { slug: siteSlug }));
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
    runId?: string;
    assetPath?: string;
    kind?: string;
    contentHash?: string;
    blobUrl?: string;
    sizeBytes?: number;
    ownerSlugs?: string[];
    sensitive?: boolean;
    sensitiveInclude?: string[];
    visibilityHash?: string;
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
  const owned = body.runId?.startsWith(OWNED_RUN_PREFIX);
  if (owned && !/^[0-9a-f]{16,64}$/.test(contentHash)) return new Response("Invalid content hash", { status: 400 });
  const expectedKey = siteBlobKey(siteSlug, owned ? `${kind}s/${contentHash}/${assetPath}` : `${kind}s/${assetPath}`);
  let blobPath: string;
  try { blobPath = decodeURIComponent(new URL(blobUrl).pathname).replace(/^\//, ""); }
  catch { return new Response("Invalid blobUrl", { status: 400 }); }
  if (blobPath !== expectedKey) {
    return new Response("blobUrl does not match site/path/hash", { status: 400 });
  }
  await requirePublishSite(request, client, siteSlug);
  await client.mutation(
    kind === "pdf"
      ? api.documents.upsertPdfAsset
      : api.documents.upsertFileAsset,
    withSiteSlug(siteSlug, {
      runId: body.runId,
      path: assetPath,
      blobUrl,
      sizeBytes,
      contentHash,
      ownerSlugs: body.ownerSlugs,
      sensitive: body.sensitive,
      sensitiveInclude: body.sensitiveInclude,
      visibilityHash: body.visibilityHash,
    }),
  );
  return Response.json({ ok: true, blobUrl, sizeBytes });
}

async function handleAssetHashBackfill(request: Request, client: ConvexHttpClient) {
  const body = (await request.json()) as {
    siteSlug?: string;
    runId?: string;
    entries?: Array<{
      path?: string;
      kind?: string;
      contentHash?: string;
      ownerSlugs?: string[];
      sensitive?: boolean;
      sensitiveInclude?: string[];
      visibilityHash?: string;
    }>;
  };
  const siteSlug = body.siteSlug ?? "";
  if (!siteSlug) return new Response("siteSlug required", { status: 400 });
  const entries = (body.entries ?? []).map((entry) => ({
    path: entry.path ?? "",
    kind: entry.kind === "pdf" ? ("pdf" as const) : ("file" as const),
    contentHash: entry.contentHash ?? "",
    ownerSlugs: Array.isArray(entry.ownerSlugs) ? entry.ownerSlugs : [],
    sensitive: entry.sensitive ?? false,
    hasSensitive: typeof entry.sensitive === "boolean",
    sensitiveInclude: Array.isArray(entry.sensitiveInclude)
      ? entry.sensitiveInclude
      : [],
    visibilityHash: entry.visibilityHash ?? "",
  }));
  if (entries.length === 0) return new Response("entries required", { status: 400 });
  if (
    entries.some(
      (entry) =>
        !entry.path ||
        !entry.contentHash ||
        !entry.hasSensitive ||
        !entry.visibilityHash,
    )
  ) {
    return new Response(
      "entry path, contentHash, sensitive, and visibilityHash required",
      { status: 400 },
    );
  }
  await requirePublishSite(request, client, siteSlug);
  const validatedEntries = entries.map(({ hasSensitive: _, ...entry }) => entry);
  const result = await client.mutation(
    api.documents.backfillAssetHashes,
    withSiteSlug(siteSlug, { entries: validatedEntries, runId: body.runId }),
  );
  return Response.json(result);
}

async function handleDocumentHashBackfill(request: Request, client: ConvexHttpClient) {
  const body = (await request.json()) as {
    siteSlug?: string;
    runId?: string;
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
      runId: body.runId,
      hashFunctionVersion: body.hashFunctionVersion,
      entries,
    }),
  );
  return Response.json(result);
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
  let beginningSite: { slug: string; runId?: string } | undefined;
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

    if (step === "status") {
      if (!Number.isInteger(body.minimumRevision) || body.minimumRevision < 0 ||
          !Array.isArray(body.documents) || body.documents.length > 1000 ||
          body.documents.some((doc: any) => !doc || typeof doc.slug !== "string" || typeof doc.hash !== "string" || typeof doc.sensitive !== "boolean") ||
          !Array.isArray(body.assets) || body.assets.length > 1024 ||
          body.assets.some((asset: any) => !asset || typeof asset.path !== "string" || typeof asset.hash !== "string" || typeof asset.sensitive !== "boolean" || !["pdf", "file"].includes(asset.kind))) {
        return new Response("Invalid publisher readiness scope", { status: 400 });
      }
      return await traceBackendPhase("publish.reader", async () => {
        const status = await client.query(api.sites.publisherStatus, { slug: siteSlug });
        if (status.revision < body.minimumRevision || !status.snapshot) return Response.json({ ready: false, revision: status.revision });
        const response = await fetch(status.snapshot.url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
        if (!response.ok) throw new Error("Reader manifest bytes unavailable");
        const raw = await response.json();
        const manifest = parseWikiManifest(raw);
        const core = { schemaVersion: raw.schemaVersion, siteSlug: raw.siteSlug, scope: raw.scope, compactTree: raw.compactTree, pages: raw.pages, assets: raw.assets };
        const hash = crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24);
        if (manifest.siteSlug !== siteSlug || manifest.scope !== "public" || manifest.manifestHash !== status.snapshot.hash || hash !== manifest.manifestHash) throw new Error("Reader manifest integrity check failed");
        const pages = new Map(manifest.pages.map(doc => [doc.slug, doc]));
        const assets = new Map(manifest.assets.map(asset => [assetKey(asset), asset]));
        const documentMismatches = body.documents.filter((doc: { slug: string; hash: string; sensitive: boolean }) => doc.sensitive ? pages.has(doc.slug) : pages.get(doc.slug)?.contentHash !== doc.hash).length;
        const assetMismatches = body.assets.filter((asset: { path: string; kind: "pdf" | "file"; hash: string; sensitive: boolean }) => asset.sensitive ? assets.has(assetKey(asset)) : assets.get(assetKey(asset))?.contentHash !== asset.hash).length;
        return Response.json({ ready: documentMismatches === 0 && assetMismatches === 0, revision: status.revision, documentMismatches, assetMismatches });
      });
    }

    if (step === "state") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      if (!Array.isArray(body.slugs) || body.slugs.length > 16 ||
          body.slugs.some((slug: unknown) => typeof slug !== "string" || !slug || slug.length > 2048) ||
          !Array.isArray(body.assets) || body.assets.length > 128 ||
          body.assets.some((asset: { path?: unknown; kind?: unknown } | null) => !asset || typeof asset.path !== "string" || !asset.path || asset.path.length > 2048 || !["file", "pdf"].includes(String(asset.kind)))) {
        return new Response("state requires at most 16 slugs and 128 assets", { status: 400 });
      }
      return Response.json(await traceBackendPhase("publish.state", () => client.query(
        api.documents.publisherState, { siteSlug, slugs: body.slugs, assets: body.assets },
      )));
    }

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

    if (step === "begin" || step === "scoped/begin") {
      const scoped = step === "scoped/begin";
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const manifest = (body.manifest ?? {}) as Manifest;
      if (scoped && (!Array.isArray(manifest.documents) || manifest.documents.length > 1000 ||
          manifest.documents.some(doc => !doc || typeof doc.slug !== "string" || !doc.slug || typeof doc.hash !== "string") ||
          !Array.isArray(manifest.assets) || manifest.assets.length > 1024 ||
          manifest.assets.some(asset => !asset || typeof asset.path !== "string" || !asset.path || typeof asset.hash !== "string" || !["pdf", "file"].includes(asset.kind ?? "")))) {
        return new Response("Scoped publish requires at most 1000 documents and 1024 assets", { status: 400 });
      }
      const runId = scoped ? (body.runId ?? `${OWNED_RUN_PREFIX}${crypto.randomUUID()}`) : crypto.randomUUID();
      if (scoped && (typeof runId !== "string" || !/^scoped:[0-9a-f-]{36}$/.test(runId))) return new Response("Invalid scoped runId", { status: 400 });
      const runScope = scoped ? { documents: manifest.documents!.map(doc => doc.slug), assets: manifest.assets!.map(assetKey) } : undefined;
      if (runScope && JSON.stringify(runScope).length > 200_000) return new Response("Scoped publish manifest is too large", { status: 400 });
      const force = Boolean(body.force);
      const dryRun = Boolean(body.dryRun);
      const manifestHashFunctionVersion =
        typeof body.hashFunctionVersion === "number"
          ? body.hashFunctionVersion
          : undefined;
      if (!dryRun) {
        await traceBackendPhase("publish.lock", () => client.mutation(api.sites.beginPublish, { slug: siteSlug, runId: scoped ? runId : undefined, scope: runScope }));
        beginningSite = { slug: siteSlug, runId: scoped ? runId : undefined };
      }
      const selectedStates: Awaited<ReturnType<typeof client.query<typeof api.documents.publisherState>>>[] = [];
      if (scoped) {
        const docs = manifest.documents!, assets = manifest.assets!;
        for (let i = 0; i < Math.max(Math.ceil(docs.length / 16), Math.ceil(assets.length / 128)); i++) {
          selectedStates.push(await traceBackendPhase("publish.state", () => client.query(api.documents.publisherState, {
            siteSlug, slugs: docs.slice(i * 16, (i + 1) * 16).map(doc => doc.slug),
            assets: assets.slice(i * 128, (i + 1) * 128).map(asset => ({ path: asset.path, kind: asset.kind! })),
          })));
        }
      }
      const existingDocHashes = scoped
        ? new Map(selectedStates.flatMap(state => state.documents.filter(doc => doc.exists).map(doc => [doc.slug, {
            contentHash: doc.readerContentConsistent === false ? undefined : doc.observedHash != null && doc.observedHash !== doc.contentHash ? doc.observedHash : doc.contentHash ?? undefined, hasRawContent: doc.observedHash != null,
            hashFunctionVersion: doc.hashFunctionVersion, sensitive: doc.sensitive,
          }] as const)))
        : await traceBackendPhase("publish.inventory.documents", () => currentDocumentHashes(client, siteSlug));
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
          !existing.hasRawContent && !(scoped && body.verification === "metadata");
        if (
          force ||
          !existing ||
          existing.contentHash !== doc.hash ||
          (scoped && manifestHashFunctionVersion !== undefined && existing.hashFunctionVersion !== manifestHashFunctionVersion) ||
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

      const existingAssetHashes = scoped
        ? new Map(selectedStates.flatMap(state => state.assets.filter(asset => asset.exists).map(asset => [assetKey(asset), {
            kind: asset.kind, path: asset.path, contentHash: asset.contentHash ?? undefined,
            blobUrl: asset.hasBlob ? "present" : undefined,
            visibilityHash: asset.hasVisibility && asset.visibilityHash === asset.observedVisibilityHash ? asset.visibilityHash ?? undefined : undefined,
          }] as const)))
        : await traceBackendPhase("publish.inventory.assets", () => currentAssetHashes(client, siteSlug));
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
        } else if (!existing.blobUrl) {
          assetChanges.push({ path: asset.path, kind, reason: "missingRemoteBlob" });
        } else if (!existing.contentHash && existing.blobUrl) {
          assetChanges.push({
            path: asset.path,
            kind,
            reason: scoped ? "unverifiedRemoteBytes" : "missingRemoteContentHash",
          });
        } else if (existing.contentHash !== asset.hash) {
          assetChanges.push({ path: asset.path, kind, reason: "hashMismatch" });
        } else if (scoped && "visibilityHash" in existing && existing.visibilityHash !== asset.visibilityHash) {
          assetChanges.push({ path: asset.path, kind, reason: "metadataMismatch" });
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
        scoped,
        runId,
        missingDocumentSlugs,
        rawContentBackfillSlugs,
        missingAssetPaths,
        assetChanges,
        staleDocumentSlugs: scoped ? [] : staleDocumentSlugs,
        staleAssetPaths: scoped ? [] : staleAssetPaths,
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
      const { redactedContent, rawContent } = await traceBackendPhase("publish.document.prepare", () => {
        // Protocol hash v3 covers the exact source content and visibility fields.
        if (body.runId?.startsWith(OWNED_RUN_PREFIX) || hashFunctionVersion === 3) {
          const computed = crypto.createHash("sha256").update(JSON.stringify({ title, content,
            tags: Array.isArray(tags) ? tags : [], sensitive: sensitive === true,
            sensitiveInclude: Array.isArray(sensitiveInclude) ? sensitiveInclude : [],
          })).digest("hex").slice(0, 16);
          if (hashFunctionVersion !== 3 || hash !== computed) throw new Response("Source content does not match hash/version", { status: 400 });
        }
        const redactedContent = applyPiiRedactions(content, { patterns: piiPatterns });
        const bytes = new TextEncoder().encode(content).byteLength + new TextEncoder().encode(redactedContent).byteLength;
        return { redactedContent, rawContent: bytes <= MAX_DOCUMENT_CONTENT_STORAGE_BYTES ? content : undefined };
      });
      await client.mutation(
        api.documents.upsert,
        withSiteSlug(siteSlug, {
          runId: typeof body.runId === "string" ? body.runId : undefined,
          slug,
          title,
          content: redactedContent,
          rawContent,
          replaceRawContent: true,
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
          withSiteSlug(siteSlug, { slug, embedding, embeddingHash: hash, runId: typeof body.runId === "string" ? body.runId : undefined }),
        );
      }
      return Response.json({ ok: true });
    }

    if (step === "abort" || step === "scoped/abort") {
      if (step === "scoped/abort" && (typeof body.runId !== "string" || !body.runId.startsWith(OWNED_RUN_PREFIX))) return new Response("Scoped runId required", { status: 400 });
      const errorMessage =
        typeof body.error === "string" ? body.error.slice(0, 2000) : "publisher aborted";
      await client.mutation(api.sites.failPublish, { slug: siteSlug, error: errorMessage, runId: typeof body.runId === "string" ? body.runId : undefined });
      return Response.json({ ok: true });
    }

    if (step === "finish" || step === "scoped/finish") {
      if (step === "scoped/finish" && (typeof body.runId !== "string" || !body.runId.startsWith(OWNED_RUN_PREFIX))) return new Response("Scoped runId required", { status: 400 });
      const runId = typeof body.runId === "string" ? body.runId : undefined;
      assertPublishRun(site, runId, { deletion: Boolean(body.deletedDocSlugs?.length || body.deletedAssetPaths?.length) });
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
        const finished = await client.mutation(api.sites.finishPublish, { slug: siteSlug, runId });
        return Response.json({ ok: true, revision: finished.revision, postPublishRunId: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await client
          .mutation(api.sites.failPublish, { slug: siteSlug, error: message, runId })
          .catch(() => {});
        throw error;
      }
    }

    return new Response(`Unknown publish step: ${step}`, { status: 404 });
  } catch (error) {
    if (beginningSite) {
      await client.mutation(api.sites.failPublish, { ...beginningSite, error: "Publish planning failed" }).catch(() => {});
    }
    if (error instanceof Response) return error;
    logRouteError(step, error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ step, error: message }, { status: message.includes("Publish conflict:") || message.includes("publish already running") ? 409 : 500 });
  }
}
