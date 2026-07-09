import { DiagnosticImaging } from "@oncobase/diagnostics/imaging";

import { getDiagnosticComparisonsForCurrentSite } from "@/lib/dicom-comparisons-server";
import { getDiagnosticStudiesForCurrentSite } from "@/lib/diagnostic-studies-server";

export const metadata = {
  title: "Diagnostic Imaging",
};

interface DiagnosticImagingPageProps {
  searchParams: Promise<{
    studySet?: string;
  }>;
}

export default async function DiagnosticImagingPage({
  searchParams,
}: DiagnosticImagingPageProps) {
  const params = await searchParams;
  const [studies, comparisons] = await Promise.all([
    getDiagnosticStudiesForCurrentSite(params.studySet),
    getDiagnosticComparisonsForCurrentSite(params.studySet),
  ]);

  return (
    <DiagnosticImaging
      comparisons={comparisons}
      studies={studies}
      studySet={params.studySet}
    />
  );
}
