import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { applyPiiRedactions } from "@/lib/pii-redaction";
import { sitePut } from "@/lib/blob";

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

async function requirePublishSite(request: Request, siteSlug: string) {
  const token = bearerToken(request);
  if (!token) {
    throw new Response("Missing bearer token", { status: 401 });
  }
  const convex = getConvexServerClient();
  const site = await convex.query(api.sites.getBySlug, { slug: siteSlug });
  if (!site || site.publishTokenHash !== hashToken(token)) {
    throw new Response("Invalid publish token", { status: 401 });
  }
  return { convex, site };
}

async function currentDocumentHashes(siteSlug: string) {
  const convex = getConvexServerClient();
  const hashes = new Map<string, string | undefined>();
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: {
      page: Array<{ slug: string; contentHash: string | undefined }>;
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.documents.embeddingStatusPage, {
      cursor,
      numItems: 100,
      siteSlug,
    });
    for (const doc of page.page) {
      hashes.set(doc.slug, doc.contentHash);
    }
    isDone = page.isDone;
    cursor = page.continueCursor;
  }
  return hashes;
}

async function currentAssetHashes(siteSlug: string) {
  const convex = getConvexServerClient();
  const hashes = new Map<string, string | undefined>();
  const pdfs = await convex.query(api.documents.listPdfAssets, { siteSlug });
  for (const asset of pdfs) hashes.set(`pdf:${asset.path}`, asset.contentHash);
  const files = await convex.query(api.documents.listFileAssets, { siteSlug });
  for (const asset of files)
    hashes.set(`file:${asset.path}`, asset.contentHash);
  return hashes;
}

async function handleAssetUpload(request: Request) {
  const siteSlug = request.headers.get("x-publish-site") ?? "";
  if (!siteSlug)
    return new Response("x-publish-site header required", { status: 400 });

  const assetPath = request.headers.get("x-publish-path") ?? "";
  if (!assetPath)
    return new Response("x-publish-path header required", { status: 400 });

  const kindHeader = request.headers.get("x-publish-kind");
  const kind: "pdf" | "file" = kindHeader === "pdf" ? "pdf" : "file";

  const contentHash = request.headers.get("x-publish-hash") ?? "";
  if (!contentHash)
    return new Response("x-publish-hash header required", { status: 400 });

  const contentType =
    request.headers.get("content-type") ?? "application/octet-stream";

  const { convex } = await requirePublishSite(request, siteSlug);

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.byteLength === 0) {
    return new Response("Empty request body", { status: 400 });
  }

  const blob = await sitePut(siteSlug, `${kind}s/${assetPath}`, buffer, {
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  if (kind === "pdf") {
    await convex.mutation(api.documents.upsertPdfAsset, {
      siteSlug,
      path: assetPath,
      blobUrl: blob.url,
      sizeBytes: buffer.byteLength,
      contentHash,
    });
  } else {
    await convex.mutation(api.documents.upsertFileAsset, {
      siteSlug,
      path: assetPath,
      blobUrl: blob.url,
      sizeBytes: buffer.byteLength,
      contentHash,
    });
  }

  return NextResponse.json({
    ok: true,
    blobUrl: blob.url,
    sizeBytes: buffer.byteLength,
  });
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

    const { convex } = await requirePublishSite(request, siteSlug);

    if (step === "begin") {
      const manifest = (body.manifest ?? {}) as Manifest;
      const force = Boolean(body.force);
      const dryRun = Boolean(body.dryRun);
      // wiki:check sets dryRun so a check doesn't acquire the lock
      // and block real publishes for ten minutes.
      if (!dryRun) {
        await convex.mutation(api.sites.beginPublish, { slug: siteSlug });
      }

      const existingDocHashes = await currentDocumentHashes(siteSlug);
      const missingDocumentSlugs = force
        ? (manifest.documents ?? []).map((doc) => doc.slug)
        : (manifest.documents ?? [])
            .filter((doc) => existingDocHashes.get(doc.slug) !== doc.hash)
            .map((doc) => doc.slug);

      const existingAssetHashes = await currentAssetHashes(siteSlug);
      const missingAssetPaths = force
        ? (manifest.assets ?? []).map((asset) => asset.path)
        : (manifest.assets ?? [])
            .filter((asset) => {
              const key = `${asset.kind ?? "file"}:${asset.path}`;
              return existingAssetHashes.get(key) !== asset.hash;
            })
            .map((asset) => asset.path);

      return NextResponse.json({
        runId: crypto.randomUUID(),
        missingDocumentSlugs,
        missingAssetPaths,
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
      const redactedContent = applyPiiRedactions(content);
      await convex.mutation(api.documents.upsert, {
        siteSlug,
        slug,
        title,
        content: redactedContent,
        tags: Array.isArray(tags) ? tags : [],
        contentHash: hash,
      });
      if (Array.isArray(embedding)) {
        await convex.mutation(api.documents.upsertEmbedding, {
          siteSlug,
          slug,
          embedding,
          embeddingHash: hash,
        });
      }
      revalidateTag(`site:${siteSlug}:doc:${slug}`, "default");
      return NextResponse.json({ ok: true });
    }

    if (step === "finish") {
      for (const slug of body.deletedDocSlugs ?? []) {
        if (typeof slug === "string") {
          await convex.mutation(api.documents.deleteBySlug, { siteSlug, slug });
        }
      }
      await convex.mutation(api.sites.finishPublish, { slug: siteSlug });
      revalidateTag(`site:${siteSlug}`, "default");
      return NextResponse.json({ ok: true });
    }

    return new Response(`Unknown publish step: ${step}`, { status: 404 });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 500 });
  }
}
