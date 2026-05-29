import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { applyPiiRedactions, parseSitePiiPatterns } from "@/lib/pii-redaction";
import { siteDataFromRequest } from "@/lib/site-data";

// Site-scoped text search endpoint. Reads the active site from the
// proxy-set `x-site-slug` header and forwards to the Convex
// `documents.search` query. Used by the cross-site leak test fixture
// in e2e/multi-site-isolation.spec.ts.

export async function GET(request: NextRequest) {
  const siteData = siteDataFromRequest(request);
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, Number(limitParam))) : 10;

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  const results = await siteData.documents.search({
    query,
    limit,
  });

  const site = await getConvexServerClient().query(api.sites.getBySlug, {
    slug: siteData.siteSlug,
  });
  const piiPatterns = parseSitePiiPatterns(site?.config.piiPatterns);
  const redact = (value: unknown) =>
    typeof value === "string"
      ? applyPiiRedactions(value, { patterns: piiPatterns })
      : value;

  return NextResponse.json({
    results: results.map((result) => ({
      ...result,
      excerpt: redact("excerpt" in result ? result.excerpt : undefined),
      title: redact("title" in result ? result.title : undefined),
    })),
  });
}
