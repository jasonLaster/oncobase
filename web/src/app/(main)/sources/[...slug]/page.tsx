import type { Metadata } from "next";
import { connection } from "next/server";
import {
  DocumentPage,
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
  await connection();

  return <DocumentPage params={withSourcesPrefix(params)} />;
}
