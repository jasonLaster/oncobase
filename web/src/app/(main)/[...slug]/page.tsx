import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { getMarkdownFile, getMarkdownFileAsync, getAllSlugs } from "@/lib/markdown";
import { MarkdownRenderer, MarkdownRendererAsync } from "@/components/markdown-renderer";
import { CopyPageButton } from "@/components/copy-page-button";
import { DocumentComments } from "@/components/document-comments-wrapper";

// All sources/ content is immutable raw documents rarely visited directly.
// Deferring them to on-demand ISR saves significant build time.
const ISR_DEFERRED_PREFIXES = ["sources/"];

export async function generateStaticParams() {
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

// ── Build-time description cache ─────────────────────────────────────────────
let _descriptionsCache: Promise<Map<string, string>> | null = null;

function getDescriptionMap(): Promise<Map<string, string>> {
  if (!_descriptionsCache) _descriptionsCache = fetchAllDescriptions();
  return _descriptionsCache;
}

async function fetchAllDescriptions(): Promise<Map<string, string>> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new Map();
  try {
    const convex = new ConvexHttpClient(convexUrl);
    const map = new Map<string, string>();
    let cursor: string | null = null;
    let isDone = false;
    const t0 = Date.now();
    while (!isDone) {
      const page = await convex.query(api.documents.listPageDescriptions, { cursor, numItems: 100 }) as {
        page: Array<{ slug: string; description: string | null }>;
        isDone: boolean;
        continueCursor: string;
      };
      for (const { slug, description } of page.page) {
        if (description) map.set(slug, description);
      }
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    console.log(`[build] descriptions loaded: ${map.size} in ${Date.now() - t0}ms`);
    return map;
  } catch (err) {
    console.warn("[build] failed to load descriptions:", err);
    return new Map();
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const filePath = slug.map(decodeURIComponent).join("/");
  const file = getMarkdownFile(filePath);
  if (!file) return {};

  const description = (await getDescriptionMap()).get(file.slug) ?? null;

  return {
    title: `${file.title} — Diana's TNBC`,
    description: description ?? undefined,
    openGraph: {
      title: file.title,
      description: description ?? undefined,
      type: "article",
    },
    twitter: {
      card: "summary",
      title: file.title,
      description: description ?? undefined,
    },
  };
}

// ── Content skeleton shown while ISR pages render on first visit ─────────────
function ContentSkeleton() {
  return (
    <div className="animate-pulse space-y-2.5 py-2">
      <div className="h-3.5 w-full rounded bg-[var(--sidebar-border)]" />
      <div className="h-3.5 w-4/5 rounded bg-[var(--sidebar-border)]" />
      <div className="h-3.5 w-3/5 rounded bg-[var(--sidebar-border)]" />
    </div>
  );
}

// ── Async page content — wrapped in Suspense for PPR ─────────────────────────
async function DocContent({ filePath }: { filePath: string }) {
  const file = await getMarkdownFileAsync(filePath);

  if (!file) {
    notFound();
  }

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={file.title}>
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
      <MarkdownRendererAsync content={file.content} currentSlug={file.slug} />
    </DocumentComments>
  );
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const filePath = slug.map(decodeURIComponent).join("/");

  // Redirect .pdf URLs to the file-serving API route
  if (filePath.endsWith(".pdf")) {
    redirect(`/api/file?path=${encodeURIComponent(filePath)}`);
  }

  // Strip .md suffix — URLs like /wiki/foo.md should serve /wiki/foo
  const cleanPath = filePath.endsWith(".md") ? filePath.slice(0, -3) : filePath;
  if (cleanPath !== filePath) {
    redirect(`/${cleanPath}`);
  }

  return (
    <Suspense fallback={<ContentSkeleton />}>
      <DocContent filePath={filePath} />
    </Suspense>
  );
}
