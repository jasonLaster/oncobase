import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import {
  applyPiiRedactions,
  parseSitePiiPatterns,
  type PiiPattern,
} from "@/lib/pii-redaction";
import { siteBlobKey } from "@/lib/blob";
import { siteDataFromSlug, type SiteData } from "@/lib/site-data";

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

async function currentDocumentHashes(siteData: SiteData) {
  const hashes = new Map<string, string | undefined>();
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      page: Array<{ slug: string; contentHash: string | undefined }>;
      isDone: boolean;
      continueCursor: string;
    } = await siteData.documents.embeddingStatusPage({
      cursor,
      numItems: 100,
    });
    for (const doc of page.page) {
      hashes.set(doc.slug, doc.contentHash);
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return hashes;
}

async function currentAssetHashes(siteData: SiteData) {
  const hashes = new Map<string, string | undefined>();
  const pdfs = await siteData.documents.listPdfAssets();
  for (const asset of pdfs) hashes.set(`pdf:${asset.path}`, asset.contentHash);
  const files = await siteData.documents.listFileAssets();
  for (const asset of files)
    hashes.set(`file:${asset.path}`, asset.contentHash);
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

  return NextResponse.json({ ok: true, blobUrl, sizeBytes });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ step: string[] }> },
) {
  const step = (await params).step.join("/");

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

    if (step === "begin") {
      const manifest = (body.manifest ?? {}) as Manifest;
      const force = Boolean(body.force);
      const dryRun = Boolean(body.dryRun);
      // wiki:check sets dryRun so a check doesn't acquire the lock
      // and block real publishes for ten minutes.
      if (!dryRun) {
        await convex.mutation(api.sites.beginPublish, { slug: siteSlug });
      }

      const existingDocHashes = await currentDocumentHashes(siteData);
      const missingDocumentSlugs = force
        ? (manifest.documents ?? []).map((doc) => doc.slug)
        : (manifest.documents ?? [])
            .filter((doc) => existingDocHashes.get(doc.slug) !== doc.hash)
            .map((doc) => doc.slug);
      const manifestDocumentSlugs = new Set(
        (manifest.documents ?? []).map((doc) => doc.slug),
      );
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
      });
    }

    if (step === "document") {
      const { slug, title, content, tags, hash, embedding } = body as {
        slug?: string;
        title?: string;
        content?: string;
        tags?: string[];
        hash?: string;
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
      });
      if (Array.isArray(embedding)) {
        await siteData.documents.upsertEmbedding({
          slug,
          embedding,
          embeddingHash: hash,
        });
      }
      revalidateTag(`site:${siteSlug}:doc:${slug}`, "default");
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
        revalidateTag(`site:${siteSlug}`, "default");
        return NextResponse.json({ ok: true });
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
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 500 });
  }
}
