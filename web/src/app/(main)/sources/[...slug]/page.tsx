import type { Metadata } from "next";
import {
  DocumentPage,
  generateDocumentMetadata,
} from "../../_components/document-page";

export const unstable_instant = false;

function withSourcesPrefix(params: Promise<{ slug: string[] }>) {
  return params.then(({ slug }) => ({ slug: ["sources", ...slug] }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  return generateDocumentMetadata(withSourcesPrefix(params));
}

export default function SourcePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  return <DocumentPage params={withSourcesPrefix(params)} />;
}
