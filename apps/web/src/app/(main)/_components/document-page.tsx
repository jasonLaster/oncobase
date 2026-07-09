import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LockIcon } from "lucide-react";
import {
  WikiMarkdownBodySkeleton,
  WikiSensitiveUnavailable,
} from "@oncobase/wiki-shell/page-states";
import {
  getAllSlugs,
  getMarkdownFileForSite,
  resolveMarkdownManifestRouteForSite,
} from "@/lib/markdown";
import {
  getMarkdownPageMetadataForSite,
  toNextMetadata,
} from "@/lib/page-metadata";
import {
  MarkdownRenderer,
  MarkdownRendererAsync,
} from "@/components/markdown-renderer";
import { MarkdownTitle } from "@/components/markdown-title";
import { PageLoadingSkeleton } from "@/components/page-loading";
import { CopyPageButton } from "@/components/copy-page-button";
import { DocumentComments } from "@/components/document-comments-wrapper";
import { markdownTitleToText } from "@/lib/markdown-title";
import { DEFAULT_SITE_SLUG, getRequestSiteSlug, toSiteSlug } from "@/lib/site";
import { getSessionUserWithAdminFromCookieHeader } from "@/lib/session-user";
import { USER_SESSION_COOKIE, hashSessionToken } from "@/lib/user-auth";

// Preview deployments don't prerender pages: the runtime fetches
// content from prod Convex per request, so there's no static benefit
// to building the page tree at preview time. Production seeds the
// most-trafficked pages via generateDocumentStaticParams below.
const SEEDED_STATIC_PARAMS: { slug: string[] }[] = [
  { slug: ["about", "Index"] },
  { slug: ["about", "Log"] },
];
const SEEDED_WEEKLY_UPDATE_SLUG_RE = /^wiki\/updates\/week-[^/]+$/;
const ROUTE_SLUG_ALIASES = new Map([["about/index", "index"]]);
const ROUTE_ALIAS_CANONICAL_PATHS = new Map([["about/index", "about/Index"]]);

function shouldUseMinimalStaticParams() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.VERCEL_ENV === "preview"
  );
}

function seededWeeklyUpdateStaticParams(slugs: string[]) {
  const seeded: { slug: string[] }[] = [];
  for (const slug of slugs) {
    if (SEEDED_WEEKLY_UPDATE_SLUG_RE.test(slug)) {
      seeded.push({ slug: slug.split("/") });
    }
  }
  return seeded.sort((a, b) => a.slug.join("/").localeCompare(b.slug.join("/")));
}

export async function generateDocumentStaticParams() {
  const t0 = Date.now();
  if (shouldUseMinimalStaticParams()) {
    console.log(
      `[build] minimal generateStaticParams: ${SEEDED_STATIC_PARAMS.length} seed pages in ${Date.now() - t0}ms`
    );
    return SEEDED_STATIC_PARAMS;
  }

  const all = await getAllSlugs();
  const seededWeeklyUpdates = seededWeeklyUpdateStaticParams(all);
  const seeded = [...SEEDED_STATIC_PARAMS, ...seededWeeklyUpdates];
  console.log(
    `[build] generateStaticParams: ${seeded.length}/${all.length} seed pages (${seededWeeklyUpdates.length} weekly updates) in ${Date.now() - t0}ms`
  );
  return seeded;
}

export async function generateDocumentMetadata(
  params: Promise<{ slug: string[] }>
): Promise<Metadata> {
  const { slug } = await params;
  const routePath = slug.join("/");
  const routeAliasKey = routePath.toLowerCase();
  const contentPath = ROUTE_SLUG_ALIASES.get(routeAliasKey) ?? routePath;
  const siteSlug = await getRequestSiteSlug();
  const page = await getMarkdownPageMetadataForSite(siteSlug, contentPath);
  if (page) return toNextMetadata(page);

  if (!(await getDocumentAccess()).includeSensitive) {
    return {
      title: "Not found",
      robots: { index: false, follow: false },
    };
  }

  const sensitivePage = await getMarkdownPageMetadataForSite(siteSlug, routePath, {
    includeSensitive: true,
  });
  return sensitivePage ? toNextMetadata(sensitivePage) : {};
}

type DocumentAccess = {
  includeSensitive: boolean;
  rawContentSessionTokenHash?: string;
};

function sessionTokenHashFromCookieHeader(cookieHeader: string) {
  const sessionToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);

  return sessionToken ? hashSessionToken(sessionToken) : undefined;
}

async function getDocumentAccess(): Promise<DocumentAccess> {
  try {
    const requestHeaders = await headers();
    const cookieHeader = requestHeaders.get("cookie") ?? "";
    const user = await getSessionUserWithAdminFromCookieHeader(
      cookieHeader,
      requestHeaders,
    );
    return {
      includeSensitive: Boolean(user),
      rawContentSessionTokenHash: user?.isAdmin
        ? sessionTokenHashFromCookieHeader(cookieHeader)
        : undefined,
    };
  } catch {
    return { includeSensitive: false };
  }
}

// -- Page header (static in PPR cache) ---------------------------------------
function DocHeader({
  file,
}: {
  file: {
    slug: string;
    title: string;
    contentHash?: string;
    sensitive?: boolean;
    frontmatter: Record<string, unknown>;
  };
}) {
  const plainTitle = markdownTitleToText(file.title) || file.title;

  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-3xl font-bold">
          <MarkdownTitle title={file.title} currentSlug={file.slug} />
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          {file.sensitive === true && (
            <span
              aria-label="Sensitive page"
              title="Sensitive page"
              className="inline-flex size-7 items-center justify-center rounded-md text-[var(--text-muted)]"
            >
              <LockIcon aria-hidden="true" size={16} strokeWidth={1.8} />
            </span>
          )}
          <CopyPageButton
            slug={file.slug}
            title={plainTitle}
            contentHash={file.contentHash}
          />
        </div>
      </div>
      {Array.isArray(file.frontmatter.tags) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(file.frontmatter.tags as string[]).map((tag: string) => (
            <Link
              key={tag}
              href={`/tags/${encodeURIComponent(tag)}`}
              className="rounded-full bg-[var(--brand)]/10 px-2.5 py-0.5 text-xs text-[var(--brand)] ring-1 ring-[var(--brand)]/20 transition-colors hover:bg-[var(--brand)]/15"
            >
              {tag}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

export function SensitivePageUnavailable({
  slug,
}: {
  slug: string;
}) {
  return (
    <WikiSensitiveUnavailable
      slug={slug}
      actions={
        <Link
          href="/"
          className="wiki-shell-page-action page-action"
        >
          Back to the wiki
        </Link>
      }
    />
  );
}

// -- Async body for ISR pages (streamed via PPR) -----------------------------
async function AsyncMarkdownBody({
  filePath,
  includeSensitive,
  rawContentSessionTokenHash,
  redactionMode,
  slug,
  siteSlug,
}: {
  filePath: string;
  includeSensitive: boolean;
  rawContentSessionTokenHash?: string;
  redactionMode?: "redacted" | "revealed";
  slug: string;
  siteSlug: string;
}) {
  const file = await getMarkdownFileForSite(toSiteSlug(siteSlug), filePath, {
    includeSensitive,
    rawContentSessionTokenHash,
  });
  if (!file) notFound();
  const canRenderFromContentHash =
    Boolean(file.contentHash) && rawContentSessionTokenHash === undefined;
  return (
    <MarkdownRendererAsync
      content={canRenderFromContentHash ? undefined : file.content}
      currentSlug={slug}
      siteSlug={siteSlug}
      contentHash={file.contentHash}
      includeSensitive={includeSensitive}
      redactionMode={redactionMode}
    />
  );
}

function MarkdownBodyFallback() {
  return <WikiMarkdownBodySkeleton />;
}

export async function renderDocumentPage({
  params,
  requireAdminReveal = false,
}: {
  params: Promise<{ slug: string[] }>;
  requireAdminReveal?: boolean;
}) {
  const { slug } = await params;
  const filePath = slug.map(decodeURIComponent).join("/");
  const documentAccess = await getDocumentAccess();

  if (requireAdminReveal && !documentAccess.rawContentSessionTokenHash) {
    notFound();
  }

  // Redirect .pdf URLs to the file-serving API route
  if (/\.pdf$/i.test(filePath)) {
    redirect(`/api/file?path=${encodeURIComponent(filePath)}`);
  }

  // Strip .md suffix -- URLs like /wiki/foo.md should serve /wiki/foo
  const cleanPath = filePath.replace(/\.md$/i, "");
  if (cleanPath !== filePath) {
    redirect(`/${cleanPath}`);
  }

  const routeAliasKey = cleanPath.toLowerCase();
  const aliasCanonicalPath = ROUTE_ALIAS_CANONICAL_PATHS.get(routeAliasKey);
  if (aliasCanonicalPath && cleanPath !== aliasCanonicalPath) {
    redirect(`/${aliasCanonicalPath}`);
  }

  const contentPath = ROUTE_SLUG_ALIASES.get(routeAliasKey) ?? cleanPath;
  const requestSiteSlug = await getRequestSiteSlug();
  let includeSensitive = false;

  // Try the requested slug first. Most runtime pages already use canonical
  // casing, so public readers stay on the public manifest path.
  let { canonicalSlug, manifest } = await resolveMarkdownManifestRouteForSite(
    requestSiteSlug,
    contentPath,
    { includeSensitive },
  );

  if (!aliasCanonicalPath && canonicalSlug && canonicalSlug !== contentPath) {
    redirect(`/${canonicalSlug}`);
  }

  if (!manifest) {
    includeSensitive = documentAccess.includeSensitive;
    if (includeSensitive) {
      const resolvedSensitiveRoute = await resolveMarkdownManifestRouteForSite(
        requestSiteSlug,
        contentPath,
        { includeSensitive: true },
      );
      canonicalSlug = resolvedSensitiveRoute.canonicalSlug;
      manifest = resolvedSensitiveRoute.manifest;

      if (!aliasCanonicalPath && canonicalSlug && canonicalSlug !== contentPath) {
        redirect(`/${canonicalSlug}`);
      }
    }
  }

  if (!manifest) {
    if (!includeSensitive) {
      const sensitiveRoute = await resolveMarkdownManifestRouteForSite(
        requestSiteSlug,
        contentPath,
        { includeSensitive: true },
      );
      if (sensitiveRoute.manifest?.sensitive === true) {
        return <SensitivePageUnavailable slug={sensitiveRoute.manifest.slug} />;
      }
    }
    notFound();
  }

  const resolvedPath = manifest.slug;
  const displayFile =
    aliasCanonicalPath && manifest.slug === "index" && manifest.title === "index"
      ? { ...manifest, title: "Index" }
      : manifest;
  const plainDisplayTitle = markdownTitleToText(displayFile.title) || displayFile.title;
  // Keep index routes synchronous so `/` and `/about/Index` include body text
  // in the prerendered validation shell; normal pages use cached async HTML.
  const shouldRenderSynchronously = resolvedPath === "index";
  const siteSlug =
    resolvedPath === "index"
      ? toSiteSlug(process.env.SITE_SLUG ?? DEFAULT_SITE_SLUG)
      : requestSiteSlug;
  const syncFile = shouldRenderSynchronously
    ? await getMarkdownFileForSite(siteSlug, resolvedPath, {
        includeSensitive,
        rawContentSessionTokenHash: documentAccess.rawContentSessionTokenHash,
      })
    : null;

  if (shouldRenderSynchronously && !syncFile) {
    notFound();
  }

  return (
    <DocumentComments documentSlug={manifest.slug} documentTitle={plainDisplayTitle}>
      <DocHeader file={displayFile} />
      {shouldRenderSynchronously ? (
        <MarkdownRenderer
          content={syncFile!.content}
          currentSlug={syncFile!.slug}
          redactionMode={
            documentAccess.rawContentSessionTokenHash ? "revealed" : "redacted"
          }
        />
      ) : (
        <Suspense fallback={<MarkdownBodyFallback />}>
          <AsyncMarkdownBody
            filePath={resolvedPath}
            includeSensitive={includeSensitive}
            rawContentSessionTokenHash={documentAccess.rawContentSessionTokenHash}
            redactionMode={
              documentAccess.rawContentSessionTokenHash ? "revealed" : "redacted"
            }
            slug={manifest.slug}
            siteSlug={siteSlug}
          />
        </Suspense>
      )}
    </DocumentComments>
  );
}

export function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  return renderDocumentPage({ params });
}

export function DocumentPageLoading() {
  return (
    <PageLoadingSkeleton includeTags />
  );
}
