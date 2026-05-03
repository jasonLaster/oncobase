import type { Metadata } from "next";
import { connection } from "next/server";
import {
  DocumentPage,
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

export default function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  if (process.env.VERCEL_ENV === "preview") {
    return connection().then(() => <DocumentPage params={params} />);
  }

  return <DocumentPage params={params} />;
}
