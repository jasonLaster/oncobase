import type { Metadata } from "next";
import { getMarkdownFileForSite } from "@/lib/markdown";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { DocumentComments } from "@/components/document-comments-wrapper";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";

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

export default async function Home() {
  const file = await getMarkdownFileForSite(
    toSiteSlug(process.env.SITE_SLUG ?? DEFAULT_SITE_SLUG),
    HOME_SLUG
  );

  if (!file) {
    return <p>No index.md found.</p>;
  }

  return (
    <DocumentComments documentSlug={file.slug} documentTitle={file.title}>
      <MarkdownRenderer
        content={file.content}
        currentSlug={file.slug}
        anchorScopeKey={HOME_SLUG}
      />
    </DocumentComments>
  );
}
