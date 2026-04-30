import { NextRequest, connection } from "next/server";
import { getFileTreeWithPdfs } from "@/lib/markdown";
import { siteSlugFromRequest, DEFAULT_SITE_SLUG } from "@/lib/site";

// During the Diana migration window the file tree is fs-backed in
// markdown.ts. New sites onboarded through Phase 4 only have data
// in Convex; their sidebar tree comes from Convex documents
// directly. Until the renderer swap (deferred Phase 2c → Phase 7),
// this route returns Diana's fs-backed tree for the Diana host
// only and an empty tree for other sites — forces the
// Convex-backed sidebar work without leaking Diana's structure.

export async function GET(request: NextRequest) {
  await connection();
  const siteSlug = siteSlugFromRequest(request);

  if (siteSlug !== DEFAULT_SITE_SLUG) {
    // TODO Phase 7: build a tree from `documents.listPage` filtered
    // by siteSlug. Until then, new sites get an empty sidebar tree.
    return Response.json([], {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  const tree = await getFileTreeWithPdfs();
  return Response.json(tree, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
