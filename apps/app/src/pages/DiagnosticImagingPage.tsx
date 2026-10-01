import { type DiagnosticComparisonManifest } from "@oncobase/diagnostics/dicom";
import { DiagnosticImaging } from "@oncobase/diagnostics/imaging";
import { type PathologySlide } from "@oncobase/diagnostics/pathology/model";
import { type DiagnosticStudiesPayload } from "@oncobase/diagnostics/studies";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export function DiagnosticImagingPage() {
  const [searchParams] = useSearchParams();
  const studySet = searchParams.get("studySet");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (studySet) params.set("studySet", studySet);
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [studySet]);
  const { data: studiesPayload } = useSWR<DiagnosticStudiesPayload>(
    `/api/diagnostic-studies${query}`,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const { data: comparisonsPayload } = useSWR<{ comparisons: DiagnosticComparisonManifest[] }>(
    `/api/dicom/comparisons${query}`,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const { data: pathologyPayload, error: pathologyError, mutate: reloadPathology } = useSWR<{ slides: PathologySlide[] }>(
    "/api/pathology/slides",
    fetchJson,
    { revalidateOnFocus: false },
  );

  return (
    <DiagnosticImaging
      comparisons={comparisonsPayload?.comparisons ?? []}
      pathologySlides={pathologyPayload?.slides ?? []}
      pathologyError={Boolean(pathologyError)}
      onRetryPathology={() => void reloadPathology()}
      studies={studiesPayload?.studies ?? []}
      studySet={studySet}
    />
  );
}
