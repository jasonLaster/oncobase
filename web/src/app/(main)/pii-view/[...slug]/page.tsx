import type { Metadata } from "next";
import {
  generateDocumentMetadata,
  renderDocumentPage,
} from "../../_components/document-page";


export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  return generateDocumentMetadata(params);
}

export default function PiiDocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  return renderDocumentPage({ params, showPii: true });
}
