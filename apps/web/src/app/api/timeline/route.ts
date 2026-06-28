import { NextResponse } from "next/server";

import type { DiagnosticTimelineData } from "@/lib/diagnostic-timeline-data";
import { prepareDiagnosticTimeline } from "@/lib/diagnostic-timeline-data";
import { getDiagnosticStudiesFromSiteData } from "@/lib/diagnostic-studies-server";
import { siteDataFromRequest } from "@/lib/site-data";

const TIMELINE_META_KEY = "diagnosticTimeline:data";

export async function GET(request: Request) {
  const siteData = siteDataFromRequest(request);
  const value = await siteData.documents.getMeta({
    key: TIMELINE_META_KEY,
  });

  if (!value) {
    return NextResponse.json(
      { error: `Diagnostic timeline not found for site '${siteData.siteSlug}'` },
      { status: 404 },
    );
  }

  const timeline = JSON.parse(value) as DiagnosticTimelineData;
  const diagnosticStudies = await getDiagnosticStudiesFromSiteData(siteData);

  return NextResponse.json(prepareDiagnosticTimeline(timeline, undefined, diagnosticStudies), {
    headers: {
      "Cache-Control": "no-store",
      Vary: "x-site-slug",
    },
  });
}
