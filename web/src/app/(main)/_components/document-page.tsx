import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LockIcon } from "lucide-react";
import {
  getAllSlugs,
  getCanonicalSlug,
  getMarkdownFile,
} from "@/lib/markdown";
import { getMarkdownPageMetadata, toNextMetadata } from "@/lib/page-metadata";
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
  const page = await getMarkdownPageMetadata(routePath);
  if (page) return toNextMetadata(page);

  if (!(await canViewSensitivePages())) {
    return {
      title: "Not found",
      robots: { index: false, follow: false },
    };
  }

  const sensitivePage = await getMarkdownPageMetadata(routePath, {
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

// -- Async body for ISR pages (streamed via PPR) -----------------------------
async function DeferredMarkdownBody({
  filePath,
  showPii,
  slug,
  siteSlug,
}: {
  filePath: string;
  showPii: boolean;
  slug: string;
  siteSlug: string;
}) {
  const file = await getMarkdownFile(filePath, {
    includeSensitive: true,
    piiMode: showPii ? "revealed" : "redacted",
  });
  if (!file) notFound();
  return (
    <MarkdownRendererAsync
      content={file.content}
      currentSlug={slug}
      siteSlug={siteSlug}
      contentHash={file.contentHash}
    />
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
  const includeSensitive = await canViewSensitivePages();

  // Try the requested slug first. Most runtime pages already use canonical
  // casing, and this avoids loading the full slug map in the streamed path.
  let file = await getMarkdownFile(contentPath, {
    includeSensitive,
    piiMode: showPii ? "revealed" : "redacted",
  });

  if (!file && contentPath !== "index") {
    const canonicalPath = await getCanonicalSlug(contentPath, {
      includeSensitive,
    });
    if (!aliasCanonicalPath && canonicalPath && canonicalPath !== contentPath) {
      redirect(documentRedirectPath(`/${canonicalPath}`, showPii));
    }
    file = await getMarkdownFile(canonicalPath ?? contentPath, {
      includeSensitive,
      piiMode: showPii ? "revealed" : "redacted",
    });
  }

  if (!file) {
    notFound();
  }

  const resolvedPath = file.slug;
  const displayFile =
    aliasCanonicalPath && file.slug === "index" && file.title === "index"
      ? { ...file, title: "Index" }
      : file;
  const isDeferred = ISR_DEFERRED_PREFIXES.some((p) => resolvedPath.startsWith(p));
  // Keep index routes synchronous so `/` and `/about/Index` include body text
  // in the prerendered validation shell; normal pages use cached async HTML.
  const shouldRenderSynchronously = resolvedPath === "index";
  const siteSlug =
    resolvedPath === "index"
      ? toSiteSlug(process.env.SITE_SLUG ?? DEFAULT_SITE_SLUG)
      : await getRequestSiteSlug();

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={displayFile.title}>
      <DocHeader file={displayFile} />
      {isDeferred ? (
        <Suspense fallback={null}>
          <DeferredMarkdownBody
            filePath={resolvedPath}
            showPii={showPii}
            slug={file.slug}
            siteSlug={siteSlug}
          />
        </Suspense>
      ) : shouldRenderSynchronously ? (
        <MarkdownRenderer
          content={file.content}
          currentSlug={file.slug}
        />
      ) : (
        <MarkdownRendererAsync
          content={file.content}
          currentSlug={file.slug}
          siteSlug={siteSlug}
          contentHash={file.contentHash}
        />
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
