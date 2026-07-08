import { DicomViewerClient } from "@oncobase/diagnostics/dicom";
import { useSearchParams } from "react-router";

export function DicomViewerPage() {
  const [searchParams] = useSearchParams();
  return (
    <DicomViewerClient
      initialBiopsyId={searchParams.get("biopsyId") ?? searchParams.get("id")}
      initialImageNumber={parsePositiveInteger(
        searchParams.get("image") ?? searchParams.get("slice"),
      )}
      initialSeriesId={searchParams.get("seriesId")}
      initialStudySet={searchParams.get("studySet")}
    />
  );
}

function parsePositiveInteger(value: string | null) {
  if (!value) return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}
