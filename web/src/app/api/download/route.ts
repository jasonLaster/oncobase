import { NextResponse } from "next/server";

export async function GET() {
  // The zip is pre-built at build time into public/diana-tnbc-wiki.zip
  // Just redirect to the static file
  return NextResponse.redirect(new URL("/diana-tnbc-wiki.zip", process.env.NEXT_PUBLIC_CONVEX_SITE_URL || "https://diana-tnbc.vercel.app"));
}
