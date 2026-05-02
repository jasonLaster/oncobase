import { NextRequest, NextResponse } from "next/server";
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

  return NextResponse.json({ results });
}
