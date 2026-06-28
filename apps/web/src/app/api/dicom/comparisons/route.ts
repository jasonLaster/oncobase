import { NextResponse } from "next/server";

import { DIAGNOSTIC_COMPARISON_SET_PARAM } from "@/lib/dicom-comparisons";
import { getDiagnosticComparisonsForRequest } from "@/lib/dicom-comparisons-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const comparisonSet = url.searchParams.get(DIAGNOSTIC_COMPARISON_SET_PARAM);
  const comparisons = await getDiagnosticComparisonsForRequest(request, comparisonSet);

  return NextResponse.json(
    { comparisons },
    {
      headers: {
        "Cache-Control": "no-store",
        Vary: "x-site-slug",
      },
    },
  );
}
