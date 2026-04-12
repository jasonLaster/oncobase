import { NextRequest, NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") ?? "full";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://diana-tnbc.com";

  if (type === "full") {
    // Full wiki zip is uploaded to Vercel Blob (too large for static assets).
    // The blob URL is stored in Convex meta at build time.
    try {
      const raw = await fetchQuery(api.documents.getMeta, { key: "wiki-download-info" });
      if (raw) {
        const info = JSON.parse(raw) as { full?: { url?: string | null } };
        if (info.full?.url) {
          return NextResponse.redirect(info.full.url);
        }
      }
    } catch { /* fall through */ }

    // Fallback: try static file (works locally, may 404 in production)
    return NextResponse.redirect(new URL("/diana-tnbc-wiki-full.zip", base));
  }

  // Markdown zip is always a static asset
  return NextResponse.redirect(new URL("/diana-tnbc-wiki-markdown.zip", base));
}
