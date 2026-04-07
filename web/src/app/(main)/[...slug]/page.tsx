import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarkdownFile, getAllSlugs } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { CopyPageButton } from "@/components/copy-page-button";

export async function generateStaticParams() {
  return getAllSlugs()
    .filter((slug) => slug !== "index")
    .map((slug) => ({
      slug: slug.split("/"),
    }));
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
