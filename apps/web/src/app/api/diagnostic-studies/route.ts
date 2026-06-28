import { NextRequest, NextResponse } from "next/server";

import { DIAGNOSTIC_STUDY_SET_PARAM } from "@/lib/diagnostic-studies";
import { getDiagnosticStudiesForRequest } from "@/lib/diagnostic-studies-server";

export async function GET(request: NextRequest) {
  const studySet = request.nextUrl.searchParams.get(DIAGNOSTIC_STUDY_SET_PARAM);
  const studies = await getDiagnosticStudiesForRequest(request, studySet);

  return NextResponse.json(
    { studies },
    {
      headers: {
        "Cache-Control": "no-store",
        Vary: "x-site-slug",
      },
    },
  );
}
