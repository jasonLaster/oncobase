import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { getMarkdownFile, getAllSlugs } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { CopyPageButton } from "@/components/copy-page-button";

export const dynamicParams = true;

export async function generateStaticParams() {
  return getAllSlugs()
    .filter((slug) => slug !== "index")
    .map((slug) => ({
      slug: slug.split("/"),
    }));
}

// ── Build-time description cache ─────────────────────────────────────────────
// Fetched once per worker via paginated scan instead of one query per page.
// Module-level Promise ensures concurrent generateMetadata() calls share a
// single in-flight fetch rather than firing 2000+ individual Convex queries.

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

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const filePath = slug.map(decodeURIComponent).join("/");
  const file = getMarkdownFile(filePath);

  if (!file) {
    notFound();
  }

  return (
    <div className="overflow-y-auto h-full">
    <article className="px-4 py-4 md:px-8 md:py-8 max-w-4xl mx-auto">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-3xl font-bold">{file.title}</h1>
          <CopyPageButton markdown={`# ${file.title}\n\n${file.content}`} />
        </div>
        {Array.isArray(file.frontmatter.tags) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(file.frontmatter.tags as string[]).map((tag: string) => (
              <Link
                key={tag}
                href={`/tags/${encodeURIComponent(tag)}`}
                className="text-xs px-2.5 py-0.5 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] ring-1 ring-[var(--brand)]/20 hover:bg-[var(--brand)]/15 transition-colors"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}
      </header>
      <MarkdownRenderer content={file.content} />
    </article>
    </div>
  );
}
