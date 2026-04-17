import type { Metadata } from "next";
import { getMarkdownFile } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { DocumentComments } from "@/components/document-comments-wrapper";

export const metadata: Metadata = {
  title: "Home",
  description: "Breast cancer research and treatment knowledge base",
  openGraph: {
    title: "Home",
    description: "Breast cancer research and treatment knowledge base",
    type: "website",
  },
};

export default function Home() {
  const file = getMarkdownFile("index");

  if (!file) {
    return <p>No about/Index.md found.</p>;
  }

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={file.title}>
        <MarkdownRenderer content={file.content} />
    </DocumentComments>
  );
}
