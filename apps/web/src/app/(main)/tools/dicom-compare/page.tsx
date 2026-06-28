import { DicomCompareClient } from "./compare-client";

export const metadata = {
  title: "DICOM Comparison",
};

interface DicomComparePageProps {
  searchParams: Promise<{
    comparison?: string;
    studySet?: string;
  }>;
}

export default async function DicomComparePage({ searchParams }: DicomComparePageProps) {
  const params = await searchParams;
  return (
    <DicomCompareClient
      initialComparisonId={params.comparison ?? null}
      initialStudySet={params.studySet ?? null}
    />
  );
}
