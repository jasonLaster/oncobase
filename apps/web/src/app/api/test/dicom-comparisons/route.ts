import { NextRequest, NextResponse } from "next/server";

import { normalizeDiagnosticComparisonSet } from "@/lib/dicom-comparisons";
import { setDiagnosticComparisonsForRequest } from "@/lib/dicom-comparisons-server";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    comparisonSet?: string;
    comparisons?: unknown;
  };
  const comparisonSet = normalizeDiagnosticComparisonSet(body.comparisonSet);
  if (!comparisonSet) {
    return NextResponse.json({ error: "Invalid comparisonSet" }, { status: 400 });
  }

  const payload = await setDiagnosticComparisonsForRequest(request, comparisonSet, {
    comparisons: body.comparisons,
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "x-site-slug",
    },
  });
}
