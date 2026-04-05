import { notFound } from "next/navigation";
import { getMarkdownFile, getAllSlugs } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";

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
    <article>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{file.title}</h1>
        {Array.isArray(file.frontmatter.tags) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(file.frontmatter.tags as string[]).map((tag: string) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      <MarkdownRenderer content={file.content} />
    </article>
  );
}
