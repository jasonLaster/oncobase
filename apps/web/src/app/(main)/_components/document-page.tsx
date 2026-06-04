import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LockIcon } from "lucide-react";
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
import { PageLoadingSkeleton } from "@/components/page-loading";
import { CopyPageButton } from "@/components/copy-page-button";
import { DocumentComments } from "@/components/document-comments-wrapper";
import { SHOW_PII_QUERY_PARAM } from "@/lib/pii-redaction";
import { DEFAULT_SITE_SLUG, getRequestSiteSlug, toSiteSlug } from "@/lib/site";
import { getSessionUserFromCookieHeader } from "@/lib/session-user";

// All sources/ content is immutable raw documents rarely visited directly.
// Deferring them to on-demand rendering saves significant build time.
const ISR_DEFERRED_PREFIXES = ["sources/"];
// Preview deployments don't prerender pages: the runtime fetches
// content from prod Convex per request, so there's no static benefit
// to building the page tree at preview time. Production seeds the
// most-trafficked pages via generateDocumentStaticParams below.
const CACHE_COMPONENTS_VALIDATION_PARAMS: { slug: string[] }[] = [
  { slug: ["about", "Index"] },
];
const ROUTE_SLUG_ALIASES = new Map([["about/index", "index"]]);
const ROUTE_ALIAS_CANONICAL_PATHS = new Map([["about/index", "about/Index"]]);

function isPreviewDeployment() {
  return process.env.VERCEL_ENV === "preview";
}

export async function generateDocumentStaticParams() {
  const t0 = Date.now();
  if (isPreviewDeployment()) {
    console.log(
      `[build] preview generateStaticParams: ${CACHE_COMPONENTS_VALIDATION_PARAMS.length} seed page in ${Date.now() - t0}ms`
    );
    return CACHE_COMPONENTS_VALIDATION_PARAMS;
  }

  const all = await getAllSlugs();
  const params = all
    .filter((slug) => {
      if (slug === "index") return false;
      return !ISR_DEFERRED_PREFIXES.some((prefix) => slug.startsWith(prefix));
    })
    .map((slug) => ({
      slug: slug.split("/"),
    }));
  if (params.length === 0) {
    params.unshift(...CACHE_COMPONENTS_VALIDATION_PARAMS);
  }
  console.log(`[build] generateStaticParams: ${params.length}/${all.length} pages in ${Date.now() - t0}ms`);
  return params;
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

  if (!(await canViewSensitivePages())) {
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

async function canViewSensitivePages(): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    return Boolean(
      await getSessionUserFromCookieHeader(
        requestHeaders.get("cookie") ?? "",
        requestHeaders,
      ),
    );
  } catch {
    return false;
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
  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-3xl font-bold">{file.title}</h1>
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
            title={file.title}
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
    <main className="mx-auto flex min-h-[55vh] max-w-2xl flex-col justify-center px-6 py-16 text-center">
      <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-[var(--brand)]/10 text-[var(--brand)] ring-1 ring-[var(--brand)]/20">
        <LockIcon aria-hidden="true" size={22} strokeWidth={1.8} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        This page is private
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
        The page exists, but it is marked sensitive, so it is only available to
        signed-in readers with access. We keep these pages out of the public
        reader to avoid exposing private medical details, logistics, or
        confidential source material.
      </p>
      <p className="mt-4 break-words rounded-md bg-[var(--sidebar-bg)] px-3 py-2 text-xs text-[var(--text-muted)] ring-1 ring-[var(--border)]">
        {slug}
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          href="/"
          className="inline-flex h-9 items-center rounded-md bg-[var(--brand)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--brand)]/90"
        >
          Back to the wiki
        </Link>
      </div>
    </main>
  );
}

// -- Async body for ISR pages (streamed via PPR) -----------------------------
async function AsyncMarkdownBody({
  filePath,
  includeSensitive,
  showPii,
  slug,
  siteSlug,
}: {
  filePath: string;
  includeSensitive: boolean;
  showPii: boolean;
  slug: string;
  siteSlug: string;
}) {
  const file = await getMarkdownFileForSite(toSiteSlug(siteSlug), filePath, {
    includeSensitive,
    piiMode: showPii ? "revealed" : "redacted",
  });
  if (!file) notFound();
  return (
    <MarkdownRendererAsync
      content={file.content}
      currentSlug={slug}
      siteSlug={siteSlug}
      contentHash={file.contentHash}
      includeSensitive={includeSensitive}
    />
  );
}

function MarkdownBodyFallback() {
  return (
    <div
      aria-label="Loading page body"
      className="space-y-4"
      data-test-id="markdown-body-loading"
      role="status"
    >
      <div className="h-4 w-11/12 animate-pulse rounded bg-[var(--accent-light)]" />
      <div className="h-4 w-full animate-pulse rounded bg-[var(--accent-light)]" />
      <div className="h-4 w-10/12 animate-pulse rounded bg-[var(--accent-light)]" />
      <div className="h-28 w-full animate-pulse rounded-md bg-[var(--accent-light)]" />
    </div>
  );
}

function documentRedirectPath(pathname: string, showPii: boolean) {
  if (!showPii) {
    return pathname;
  }

  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}${SHOW_PII_QUERY_PARAM}=1`;
}

export async function renderDocumentPage({
  params,
  showPii = false,
}: {
  params: Promise<{ slug: string[] }>;
  showPii?: boolean;
}) {
  const { slug } = await params;
  const filePath = slug.map(decodeURIComponent).join("/");

  // Redirect .pdf URLs to the file-serving API route
  if (/\.pdf$/i.test(filePath)) {
    redirect(`/api/file?path=${encodeURIComponent(filePath)}`);
  }

  // Strip .md suffix -- URLs like /wiki/foo.md should serve /wiki/foo
  const cleanPath = filePath.replace(/\.md$/i, "");
  if (cleanPath !== filePath) {
    redirect(documentRedirectPath(`/${cleanPath}`, showPii));
  }

  const routeAliasKey = cleanPath.toLowerCase();
  const aliasCanonicalPath = ROUTE_ALIAS_CANONICAL_PATHS.get(routeAliasKey);
  if (aliasCanonicalPath && cleanPath !== aliasCanonicalPath) {
    redirect(documentRedirectPath(`/${aliasCanonicalPath}`, showPii));
  }

  const contentPath = ROUTE_SLUG_ALIASES.get(routeAliasKey) ?? cleanPath;
  const requestSiteSlug = await getRequestSiteSlug();
  let includeSensitive = false;

  // Try the requested slug first. Most runtime pages already use canonical
  // casing, and this keeps ordinary public page views off the auth/session path.
  let { canonicalSlug, manifest } = await resolveMarkdownManifestRouteForSite(
    requestSiteSlug,
    contentPath,
    {
      includeSensitive,
      piiMode: showPii ? "revealed" : "redacted",
    },
  );

  if (!aliasCanonicalPath && canonicalSlug && canonicalSlug !== contentPath) {
    redirect(documentRedirectPath(`/${canonicalSlug}`, showPii));
  }

  if (!manifest) {
    includeSensitive = await canViewSensitivePages();
    if (includeSensitive) {
      const resolvedSensitiveRoute = await resolveMarkdownManifestRouteForSite(
        requestSiteSlug,
        contentPath,
        {
          includeSensitive: true,
          piiMode: showPii ? "revealed" : "redacted",
        },
      );
      canonicalSlug = resolvedSensitiveRoute.canonicalSlug;
      manifest = resolvedSensitiveRoute.manifest;

      if (!aliasCanonicalPath && canonicalSlug && canonicalSlug !== contentPath) {
        redirect(documentRedirectPath(`/${canonicalSlug}`, showPii));
      }
    }
  }

  if (!manifest) {
    if (!includeSensitive) {
      const sensitiveRoute = await resolveMarkdownManifestRouteForSite(
        requestSiteSlug,
        contentPath,
        {
          includeSensitive: true,
          piiMode: showPii ? "revealed" : "redacted",
        },
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
        piiMode: showPii ? "revealed" : "redacted",
      })
    : null;

  if (shouldRenderSynchronously && !syncFile) {
    notFound();
  }

  return (
    <DocumentComments documentSlug={manifest.slug} documentTitle={displayFile.title}>
      <DocHeader file={displayFile} />
      {shouldRenderSynchronously ? (
        <MarkdownRenderer
          content={syncFile!.content}
          currentSlug={syncFile!.slug}
        />
      ) : (
        <Suspense fallback={<MarkdownBodyFallback />}>
          <AsyncMarkdownBody
            filePath={resolvedPath}
            includeSensitive={includeSensitive}
            showPii={showPii}
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
