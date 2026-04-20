import type { Metadata } from "next";
import {
  DocumentPage,
  generateDocumentMetadata,
  generateDocumentStaticParams,
} from "../_components/document-page";

export const unstable_instant = false;

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
  return <DocumentPage params={params} />;
}
