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

const HOME_SLUG = "index";

export default function Home() {
  const file = getMarkdownFile(HOME_SLUG);

  if (!file) {
    return <p>No index.md found.</p>;
  }

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={file.title}>
      <MarkdownRenderer content={file.content} anchorScopeKey={HOME_SLUG} />
    </DocumentComments>
  );
}
