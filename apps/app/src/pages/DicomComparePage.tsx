import { DicomCompareClient } from "@oncobase/diagnostics/dicom";
import { useSearchParams } from "react-router";

export function DicomComparePage() {
  const [searchParams] = useSearchParams();
  return (
    <DicomCompareClient
      initialComparisonId={searchParams.get("comparison")}
      initialStudySet={searchParams.get("studySet")}
    />
  );
}
