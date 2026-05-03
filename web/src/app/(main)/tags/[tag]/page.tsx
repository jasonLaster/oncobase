import type { Metadata } from "next";
import Link from "next/link";
import { getPagesByTag } from "@/lib/markdown";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const pages = await getPagesByTag(decodedTag);
  const description = `${pages.length} pages tagged "${decodedTag}"`;
  return {
    title: `Tag: ${decodedTag}`,
    description,
    openGraph: { title: `Tag: ${decodedTag}`, description },
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const pages = await getPagesByTag(decodedTag);

  return (
    <div className="overflow-y-auto h-full">
    <article className="px-4 py-4 md:px-8 md:py-8 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Tag: {decodedTag}</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {pages.length} {pages.length === 1 ? "page" : "pages"}
        </p>
      </header>
      {pages.length === 0 ? (
        <p className="text-[var(--text-muted)]">No pages found with this tag.</p>
      ) : (
        <ul className="space-y-2">
          {pages.map((page) => (
            <li key={page.slug}>
              <Link
                href={`/${page.slug}`}
                className="text-[var(--brand)] hover:underline"
              >
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
    </div>
  );
}
