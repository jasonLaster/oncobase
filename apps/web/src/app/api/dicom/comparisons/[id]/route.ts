import { NextResponse } from "next/server";

import { DIAGNOSTIC_COMPARISON_SET_PARAM } from "@/lib/dicom-comparisons";
import { getDiagnosticComparisonForRequest } from "@/lib/dicom-comparisons-server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const comparisonSet = url.searchParams.get(DIAGNOSTIC_COMPARISON_SET_PARAM);
  const comparison = await getDiagnosticComparisonForRequest(
    request,
    id,
    comparisonSet,
  );

  if (!comparison) {
    return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
  }

  return NextResponse.json(comparison, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "x-site-slug",
    },
  });
}
