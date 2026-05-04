import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import {
  applyPiiRedactions,
  parseSitePiiPatterns,
  type PiiPattern,
} from "@/lib/pii-redaction";
import { siteBlobKey } from "@/lib/blob";
import { siteDataFromSlug, type SiteData } from "@/lib/site-data";
import {
  MIN_SUPPORTED_PUBLISHER_PROTOCOL_VERSION,
  PUBLISHER_VERSION_HEADER,
} from "@/lib/publish-protocol";
import {
  revalidatePublishedAsset,
  revalidatePublishedDocument,
  revalidateSiteAfterPublish,
} from "@/lib/wiki-revalidation";
import { postPublishWorkflow } from "@/workflows/post-publish";

// Multi-tenant publish API (Phase 4). The publisher CLI in
// scripts/publish/* talks to these endpoints with a Bearer publish
// token. See plans/multi-tenant-wiki/04-publishing.md.

export const maxDuration = 300;

type Manifest = {
  documents?: Array<{ slug: string; hash: string }>;
  assets?: Array<{ path: string; hash: string; kind?: "pdf" | "file" }>;
};

function hashToken(token: string) {
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function assetKey(asset: { path: string; kind?: "pdf" | "file" }) {
  return `${asset.kind ?? "file"}:${asset.path}`;
}

function pathFromAssetKey(key: string) {
  return key.slice(key.indexOf(":") + 1);
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

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ab, bb);
}

async function requirePublishSite(request: Request, siteSlug: string) {
  const token = bearerToken(request);
  if (!token) {
    throw new Response("Missing bearer token", { status: 401 });
  }
  const convex = getConvexServerClient();
  const site = await convex.query(api.sites.getBySlug, { slug: siteSlug });
  if (!site || !constantTimeEqual(site.publishTokenHash, hashToken(token))) {
    throw new Response("Invalid publish token", { status: 401 });
  }
  return { convex, site, siteData: siteDataFromSlug(siteSlug, convex) };
}

function sitePiiPatterns(site: { config: { piiPatterns?: string[] } }): PiiPattern[] {
  return parseSitePiiPatterns(site.config.piiPatterns);
}

type DocHashRow = {
  contentHash: string | undefined;
  hashFunctionVersion: number | undefined;
};

async function currentDocumentHashes(siteData: SiteData) {
  const hashes = new Map<string, DocHashRow>();
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      page: Array<{
        slug: string;
        contentHash: string | undefined;
        hashFunctionVersion?: number | undefined;
      }>;
      isDone: boolean;
      continueCursor: string;
    } = await siteData.documents.embeddingStatusPage({
      cursor,
      numItems: 100,
    });
    for (const doc of page.page) {
      hashes.set(doc.slug, {
        contentHash: doc.contentHash,
        hashFunctionVersion: doc.hashFunctionVersion,
      });
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return hashes;
}

async function currentAssetHashes(siteData: SiteData) {
  const hashes = new Map<string, string | undefined>();
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page = (await siteData.documents.assetHashesPage({
      cursor,
      numItems: 1000,
    })) as {
      page: Array<{
        kind: "pdf" | "file";
        path: string;
        contentHash: string | undefined;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
    for (const asset of page.page) {
      hashes.set(`${asset.kind}:${asset.path}`, asset.contentHash);
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return hashes;
}

// Metadata-only finalize: the publisher uploads bytes directly to
// Vercel Blob (bypassing this function's 4.5 MB body cap) and then
// POSTs JSON here to register the resulting blob URL in Convex.
async function handleAssetUpload(request: Request) {
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
  if (!contentHash)
    return new Response("contentHash required", { status: 400 });

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

  const { siteData } = await requirePublishSite(request, siteSlug);

  if (kind === "pdf") {
    await siteData.documents.upsertPdfAsset({
      path: assetPath,
      blobUrl,
      sizeBytes,
      contentHash,
    });
  } else {
    await siteData.documents.upsertFileAsset({
      path: assetPath,
      blobUrl,
      sizeBytes,
      contentHash,
    });
  }

  revalidatePublishedAsset(siteSlug);
  return NextResponse.json({ ok: true, blobUrl, sizeBytes });
}

function logRouteError(step: string, error: unknown) {
  // Centralized so any failure path that returns 500 also leaves a
  // server-side breadcrumb. Without this, Convex query errors only
  // surface in `bunx convex logs --prod` and the Vercel access log
  // shows a bare 500 with no `logs:[]` — the publisher then sees
  // "[Request ID: ...] Server Error" and the operator has to tail
  // two log streams to find the cause.
  const stack = error instanceof Error ? error.stack : undefined;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[publish] ${step} failed: ${message}`, stack ?? "");
}

async function startPostPublishWorkflow(siteSlug: string) {
  try {
    const run = await start(postPublishWorkflow, [siteSlug]);
    console.log(`[publish] post-publish workflow started: runId=${run.runId}`);
    return run.runId;
  } catch (error) {
    logRouteError("post-publish", error);
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ step: string[] }> },
) {
  let step = "<unknown>";

  try {
    step = (await params).step.join("/");
  } catch (error) {
    logRouteError("params", error);
    return NextResponse.json(
      { error: "Failed to parse route params" },
      { status: 500 },
    );
  }

  try {
    if (step === "asset") {
      return await handleAssetUpload(request);
    }

    const body = await request.json();
    const siteSlug = body.siteSlug;
    if (typeof siteSlug !== "string") {
      return new Response("siteSlug is required", { status: 400 });
    }

    const { convex, site, siteData } = await requirePublishSite(request, siteSlug);
    const piiPatterns = sitePiiPatterns(site);

    if (step === "sync/documents") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const cursor = typeof body.cursor === "string" ? body.cursor : null;
      const numItems =
        typeof body.numItems === "number" && body.numItems > 0
          ? Math.min(body.numItems, 500)
          : 100;
      const page = await siteData.documents.listPageWithContent({
        cursor,
        numItems,
      });
      return NextResponse.json(page);
    }

    if (step === "sync/assets") {
      const unsupported = unsupportedPublisherResponse(request);
      if (unsupported) return unsupported;
      const cursor = typeof body.cursor === "string" ? body.cursor : null;
      const numItems =
        typeof body.numItems === "number" && body.numItems > 0
          ? Math.min(body.numItems, 500)
          : 100;
      const page = await siteData.documents.assetHashesPage({
        cursor,
        numItems,
      });
      return NextResponse.json(page);
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
      // wiki:check sets dryRun so a check doesn't acquire the lock
      // and block real publishes for ten minutes.
      if (!dryRun) {
        await convex.mutation(api.sites.beginPublish, { slug: siteSlug });
      }

      const existingDocHashes = await currentDocumentHashes(siteData);
      const docManifest = manifest.documents ?? [];
      const missingDocumentSlugs: string[] = [];
      // Subset of missingDocumentSlugs whose hash differs solely
      // because the stored hashFunctionVersion is older than the
      // publisher's. Surfacing this lets operators run a hash-only
      // backfill before publishing — much cheaper than re-uploading
      // every doc and regenerating embeddings.
      const staleHashVersionSlugs: string[] = [];
      for (const doc of docManifest) {
        const existing = existingDocHashes.get(doc.slug);
        if (force || !existing || existing.contentHash !== doc.hash) {
          missingDocumentSlugs.push(doc.slug);
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

      const existingAssetHashes = await currentAssetHashes(siteData);
      const missingAssetPaths = force
        ? (manifest.assets ?? []).map((asset) => asset.path)
        : (manifest.assets ?? [])
            .filter((asset) => {
              return existingAssetHashes.get(assetKey(asset)) !== asset.hash;
            })
            .map((asset) => asset.path);
      const manifestAssetKeys = new Set(
        (manifest.assets ?? []).map((asset) => assetKey(asset)),
      );
      const staleAssetPaths = Array.from(existingAssetHashes.keys())
        .filter((key) => !manifestAssetKeys.has(key))
        .map(pathFromAssetKey);

      return NextResponse.json({
        runId: crypto.randomUUID(),
        missingDocumentSlugs,
        missingAssetPaths,
        staleDocumentSlugs,
        staleAssetPaths,
        staleHashVersionSlugs,
      });
    }

    if (step === "document") {
      const { slug, title, content, tags, hash, hashFunctionVersion, embedding } = body as {
        slug?: string;
        title?: string;
        content?: string;
        tags?: string[];
        hash?: string;
        hashFunctionVersion?: number;
        embedding?: number[];
      };

      if (!slug || !title || typeof content !== "string" || !hash) {
        return new Response("slug, title, content, and hash are required", {
          status: 400,
        });
      }

      // Convex stores only redacted content. Raw markdown stays in the
      // publisher's local vault — backups, exports, search indexes,
      // and chat tools all see the redacted text. See
      // web/specs/multi-site.md.
      const redactedContent = applyPiiRedactions(content, {
        patterns: piiPatterns,
      });
      await siteData.documents.upsert({
        slug,
        title,
        content: redactedContent,
        tags: Array.isArray(tags) ? tags : [],
        contentHash: hash,
        hashFunctionVersion,
      });
      if (Array.isArray(embedding)) {
        await siteData.documents.upsertEmbedding({
          slug,
          embedding,
          embeddingHash: hash,
        });
      }
      revalidatePublishedDocument(siteSlug, slug);
      return NextResponse.json({ ok: true });
    }

    if (step === "abort") {
      // Publisher calls this in its catch/finally so a mid-flight
      // failure releases the publish lock immediately instead of
      // waiting out the 10-minute TTL. The error message is best-
      // effort context for the operator; the lock release is what
      // matters.
      const errorMessage =
        typeof body.error === "string" ? body.error.slice(0, 2000) : "publisher aborted";
      await convex
        .mutation(api.sites.failPublish, { slug: siteSlug, error: errorMessage })
        .catch((error) => {
          // failPublish errors here would just confuse the caller;
          // log and let the lock TTL out as a safety net.
          logRouteError("abort", error);
        });
      return NextResponse.json({ ok: true });
    }

    if (step === "finish") {
      // Tombstone deletions can throw on a malformed slug or transient
      // Convex error. Without explicit failPublish, the publish lock
      // sits for its full 10-minute TTL and the next publisher gets
      // "publish already running" with no obvious recovery. Wrap the
      // body so any error releases the lock and surfaces a 500.
      try {
        for (const slug of body.deletedDocSlugs ?? []) {
          if (typeof slug === "string") {
            await siteData.documents.deleteBySlug({ slug });
          }
        }
        for (const path of body.deletedAssetPaths ?? []) {
          if (typeof path === "string") {
            await siteData.documents.deletePdfAssetByPath({ path });
            await siteData.documents.deleteFileAssetByPath({ path });
          }
        }
        await convex.mutation(api.sites.finishPublish, { slug: siteSlug });
        revalidateSiteAfterPublish(siteSlug);
        const postPublishRunId = await startPostPublishWorkflow(siteSlug);
        return NextResponse.json({ ok: true, postPublishRunId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await convex
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
    // NextResponse.json sets Content-Type: application/json so the
    // publisher can parse it; plain `new Response(string)` was being
    // surfaced by Vercel as a generic "[Request ID: ...] Server
    // Error" page in some failure modes.
    return NextResponse.json(
      { step, error: message },
      { status: 500 },
    );
  }
}
