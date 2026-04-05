import Link from "next/link";
import { getAllTags, getPagesByTag } from "@/lib/markdown";

export async function generateStaticParams() {
  return getAllTags().map((tag) => ({ tag }));
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const pages = getPagesByTag(decodedTag);

  return (
    <article>
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
  );
}
