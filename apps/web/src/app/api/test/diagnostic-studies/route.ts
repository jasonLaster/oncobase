import { NextRequest, NextResponse } from "next/server";

import { normalizeDiagnosticStudySet } from "@/lib/diagnostic-studies";
import {
  deleteDiagnosticStudiesForRequest,
  setDiagnosticStudiesForRequest,
} from "@/lib/diagnostic-studies-server";

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

export async function DELETE(request: NextRequest) {
  const guarded = mutationGuard();
  if (guarded) return guarded;

  const body = (await request.json()) as { studySet?: string };
  const studySet = normalizeDiagnosticStudySet(body.studySet);
  if (!studySet) {
    return NextResponse.json({ error: "Invalid studySet" }, { status: 400 });
  }

  return NextResponse.json(
    await deleteDiagnosticStudiesForRequest(request, studySet),
    { headers: { "Cache-Control": "no-store", Vary: "x-site-slug" } },
  );
}
