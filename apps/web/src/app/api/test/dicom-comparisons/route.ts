import { NextRequest, NextResponse } from "next/server";

import { normalizeDiagnosticComparisonSet } from "@/lib/dicom-comparisons";
import {
  deleteDiagnosticComparisonsForRequest,
  setDiagnosticComparisonsForRequest,
} from "@/lib/dicom-comparisons-server";

function mutationGuard() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (process.env.E2E_ALLOW_TEST_MUTATIONS !== "1") {
    return NextResponse.json(
      { error: "An isolated Playwright test backend is required" },
      { status: 503 },
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  const guarded = mutationGuard();
  if (guarded) return guarded;

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

export async function DELETE(request: NextRequest) {
  const guarded = mutationGuard();
  if (guarded) return guarded;

  const body = (await request.json()) as { comparisonSet?: string };
  const comparisonSet = normalizeDiagnosticComparisonSet(body.comparisonSet);
  if (!comparisonSet) {
    return NextResponse.json({ error: "Invalid comparisonSet" }, { status: 400 });
  }

  return NextResponse.json(
    await deleteDiagnosticComparisonsForRequest(request, comparisonSet),
    { headers: { "Cache-Control": "no-store", Vary: "x-site-slug" } },
  );
}
