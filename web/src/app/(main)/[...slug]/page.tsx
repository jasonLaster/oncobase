import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DocumentPage,
  DocumentPageLoading,
  generateDocumentMetadata,
  generateDocumentStaticParams,
} from "../_components/document-page";


export async function generateStaticParams() {
  return generateDocumentStaticParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  return generateDocumentMetadata(params);
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  return (
    <Suspense fallback={<DocumentPageLoading />}>
      <DocumentPage params={params} />
    </Suspense>
  );
}
