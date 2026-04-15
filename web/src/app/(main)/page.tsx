import { getMarkdownFile } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { DocumentComments } from "@/components/document-comments-wrapper";

export default function Home() {
  const file = getMarkdownFile("index");

  if (!file) {
    return <p>No index.md found.</p>;
  }

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={file.title}>
        <MarkdownRenderer content={file.content} />
    </DocumentComments>
  );
}
