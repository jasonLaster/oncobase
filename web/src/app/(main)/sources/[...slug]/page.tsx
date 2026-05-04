import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DocumentPage,
  DocumentPageLoading,
  generateDocumentMetadata,
} from "../../_components/document-page";


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

export default async function SourcePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  return (
    <Suspense fallback={<DocumentPageLoading />}>
      <DocumentPage params={withSourcesPrefix(params)} />
    </Suspense>
  );
}
