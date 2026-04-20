import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getAllSlugs,
  getCanonicalSlug,
  getMarkdownFile,
  getMarkdownFileAsync,
} from "@/lib/markdown";
import { getMarkdownPageMetadata, toNextMetadata } from "@/lib/page-metadata";
import { MarkdownRenderer, MarkdownRendererAsync } from "@/components/markdown-renderer";
import { CopyPageButton } from "@/components/copy-page-button";
import { DocumentComments } from "@/components/document-comments-wrapper";

// All sources/ content is immutable raw documents rarely visited directly.
// Deferring them to on-demand rendering saves significant build time.
const ISR_DEFERRED_PREFIXES = ["sources/"];

export async function generateDocumentStaticParams() {
  const t0 = Date.now();
  const all = getAllSlugs();
  const params = all
    .filter((slug) => {
      if (slug === "index") return false;
      return !ISR_DEFERRED_PREFIXES.some((prefix) => slug.startsWith(prefix));
    })
    .map((slug) => ({
      slug: slug.split("/"),
    }));
  console.log(`[build] generateStaticParams: ${params.length}/${all.length} pages in ${Date.now() - t0}ms`);
  return params;
}

export async function generateDocumentMetadata(
  params: Promise<{ slug: string[] }>
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getMarkdownPageMetadata(slug.join("/"));
  return page ? toNextMetadata(page) : {};
}

// -- Page header (static in PPR cache) ---------------------------------------
function DocHeader({ file }: { file: { title: string; content: string; frontmatter: Record<string, unknown> } }) {
  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-3xl font-bold">{file.title}</h1>
        <CopyPageButton markdown={`# ${file.title}\n\n${file.content}`} />
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
async function DeferredMarkdownBody({ filePath, slug }: { filePath: string; slug: string }) {
  const file = await getMarkdownFileAsync(filePath);
  if (!file) notFound();
  return <MarkdownRendererAsync content={file.content} currentSlug={slug} />;
}

export async function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
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
    redirect(`/${cleanPath}`);
  }

  const canonicalPath = getCanonicalSlug(cleanPath);
  if (canonicalPath && canonicalPath !== cleanPath) {
    redirect(`/${canonicalPath}`);
  }

  // Sync file read -- always fast (local disk), provides header data for PPR cache
  const file = getMarkdownFile(canonicalPath ?? cleanPath);

  if (!file) {
    notFound();
  }

  const resolvedPath = file.slug;
  const isDeferred = ISR_DEFERRED_PREFIXES.some((p) => resolvedPath.startsWith(p));

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={file.title}>
      <DocHeader file={file} />
      {isDeferred ? (
        <Suspense fallback={null}>
          <DeferredMarkdownBody filePath={resolvedPath} slug={file.slug} />
        </Suspense>
      ) : (
        <MarkdownRenderer content={file.content} currentSlug={file.slug} />
      )}
    </DocumentComments>
  );
}

export function DocumentPageLoading() {
  return (
    <div className="h-full overflow-y-auto" role="status" aria-label="Loading page">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <article className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8">
            <header className="mb-6">
              <div className="flex items-start justify-between gap-3">
                <div className="h-9 w-2/3 max-w-2xl animate-pulse rounded-md bg-[var(--accent-light)]" />
                <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--accent-light)]" />
              </div>
              <div className="mt-3 flex gap-1.5">
                <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--accent-light)]" />
                <div className="h-5 w-24 animate-pulse rounded-full bg-[var(--accent-light)]" />
              </div>
            </header>

            <div className="space-y-4">
              <div className="h-4 w-full animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[92%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[76%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-28 w-full animate-pulse rounded-lg bg-[var(--accent-light)]" />
              <div className="h-4 w-[88%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[64%] animate-pulse rounded bg-[var(--accent-light)]" />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
