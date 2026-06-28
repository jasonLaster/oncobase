import { NextRequest, NextResponse } from "next/server";

import { normalizeDiagnosticStudySet } from "@/lib/diagnostic-studies";
import { setDiagnosticStudiesForRequest } from "@/lib/diagnostic-studies-server";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    studySet?: string;
    studies?: unknown;
  };
  const studySet = normalizeDiagnosticStudySet(body.studySet);
  if (!studySet) {
    return NextResponse.json({ error: "Invalid studySet" }, { status: 400 });
  }

  const payload = await setDiagnosticStudiesForRequest(request, studySet, {
    studies: body.studies,
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "x-site-slug",
    },
  });
}
