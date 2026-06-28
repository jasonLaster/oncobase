import { DicomViewerClient } from "./viewer-client";

export const metadata = {
  title: "DICOM Viewer",
};

interface DicomViewerPageProps {
  searchParams: Promise<{
    id?: string;
    biopsyId?: string;
    seriesId?: string;
    studySet?: string;
  }>;
}

export default async function DicomViewerPage({ searchParams }: DicomViewerPageProps) {
  const params = await searchParams;
  return (
    <DicomViewerClient
      initialBiopsyId={params.biopsyId ?? params.id ?? null}
      initialSeriesId={params.seriesId ?? null}
      initialStudySet={params.studySet ?? null}
    />
  );
}
