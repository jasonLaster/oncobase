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

export default function SourcePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  if (process.env.VERCEL_ENV === "preview") {
    return connection().then(() => (
      <DocumentPage params={withSourcesPrefix(params)} />
    ));
  }

  return <DocumentPage params={withSourcesPrefix(params)} />;
}
