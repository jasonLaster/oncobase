import type { Metadata } from "next";
import { connection } from "next/server";
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
  if (process.env.VERCEL_ENV === "preview") {
    return connection().then(() =>
      renderDocumentPage({ params, requireAdminReveal: true }),
    );
  }

  return renderDocumentPage({ params, requireAdminReveal: true });
}
