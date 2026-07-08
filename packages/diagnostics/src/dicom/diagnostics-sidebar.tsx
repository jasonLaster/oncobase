"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import useSWR from "swr";

import {
  DIAGNOSTIC_STUDY_SET_PARAM,
  getDicomViewerHref,
  type DiagnosticStudiesPayload,
} from "../studies/index.ts";

const ROW_HEIGHT = 32;

async function fetchDiagnosticStudies(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Diagnostic studies request failed: ${response.status}`);
  return (await response.json()) as DiagnosticStudiesPayload;
}

function readLocationState() {
  if (typeof window === "undefined") {
    return { activeBiopsyId: null, pathname: "", studySet: null };
  }

  const url = new URL(window.location.href);
  return {
    activeBiopsyId: url.pathname.startsWith("/tools/dicom-viewer")
      ? url.searchParams.get("id") ?? url.searchParams.get("biopsyId")
      : null,
    pathname: url.pathname,
    studySet: url.searchParams.get(DIAGNOSTIC_STUDY_SET_PARAM),
  };
}

export function DiagnosticsSidebar({
  activeBiopsyId: activeBiopsyIdProp,
  studySet: studySetProp,
}: {
  activeBiopsyId?: string | null;
  studySet?: string | null;
}) {
  const [locationState, setLocationState] = useState(readLocationState);

  useEffect(() => {
    const update = () => setLocationState(readLocationState());
    update();
    window.addEventListener("popstate", update);
    window.addEventListener("pushstate", update);
    window.addEventListener("replacestate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("pushstate", update);
      window.removeEventListener("replacestate", update);
    };
  }, []);

  const activeBiopsyId = activeBiopsyIdProp ?? locationState.activeBiopsyId;
  const studySet = studySetProp ?? locationState.studySet;
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (studySet) params.set(DIAGNOSTIC_STUDY_SET_PARAM, studySet);
    return params.toString();
  }, [studySet]);
  const imagingHref = `/diagnostics/imaging${query ? `?${query}` : ""}`;
  const { data } = useSWR<DiagnosticStudiesPayload>(
    `/api/diagnostic-studies${query ? `?${query}` : ""}`,
    fetchDiagnosticStudies,
    {
      revalidateOnFocus: false,
    },
  );
  const studies = data?.studies ?? [];

  return (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="diagnostics-sidebar"
    >
      <nav
        className="min-h-0 flex-1 select-none overflow-y-auto p-2"
        data-test-id="sidebar-tree"
      >
        <a
          href={imagingHref}
          className="mb-2 flex items-center gap-2 border-b border-[var(--sidebar-border)] px-2 pb-2 pt-1 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase transition-colors hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          data-test-id="dicom-back-to-imaging"
        >
          <ArrowLeft className="size-4" />
          Imaging
        </a>
        <div className="space-y-1">
          {studies.map((biopsy) => (
            <a
              key={biopsy.id}
              href={getDicomViewerHref(biopsy.id, studySet)}
              data-selected-file-tree-item={
                activeBiopsyId === biopsy.id ? "true" : undefined
              }
              className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                activeBiopsyId === biopsy.id
                  ? "bg-[var(--accent-light)] font-medium text-[var(--foreground)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
              }`}
              style={{ minHeight: ROW_HEIGHT }}
              title={biopsy.title}
            >
              <span className="block truncate">{biopsy.title}</span>
            </a>
          ))}
        </div>
      </nav>
    </aside>
  );
}
