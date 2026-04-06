import { getMarkdownFile } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";

export default function Home() {
  const file = getMarkdownFile("index");

  if (!file) {
    return <p>No index.md found.</p>;
  }

  return (
    <div className="overflow-y-auto h-full">
      <article className="px-4 py-4 md:px-8 md:py-8 max-w-4xl mx-auto">
        <MarkdownRenderer content={file.content} />
      </article>
    </div>
  );
}
