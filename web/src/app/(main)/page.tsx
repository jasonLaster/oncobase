import { getMarkdownFile } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";

export default function Home() {
  const file = getMarkdownFile("index");

  if (!file) {
    return <p>No index.md found.</p>;
  }

  return (
    <article>
      <MarkdownRenderer content={file.content} />
    </article>
  );
}
