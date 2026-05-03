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

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  await connection();

  return <DocumentPage params={params} />;
}
