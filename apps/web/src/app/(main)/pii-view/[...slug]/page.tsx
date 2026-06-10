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
  await connection();
  return generateDocumentMetadata(params);
}

export default async function PiiDocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  // Admin reveal depends on per-request cookies; serving a prerendered shell can
  // leave non-admin readers stuck on the loading fallback instead of resolving
  // the route access decision.
  await connection();
  return renderDocumentPage({ params, requireAdminReveal: true });
}
