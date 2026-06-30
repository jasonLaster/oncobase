import { DicomViewerClient } from "./viewer-client";

export const metadata = {
  title: "DICOM Viewer",
};

interface DicomViewerPageProps {
  searchParams: Promise<{
    id?: string;
    biopsyId?: string;
    image?: string;
    seriesId?: string;
    slice?: string;
    studySet?: string;
  }>;
}

export default async function DicomViewerPage({ searchParams }: DicomViewerPageProps) {
  const params = await searchParams;
  return (
    <DicomViewerClient
      initialBiopsyId={params.biopsyId ?? params.id ?? null}
      initialImageNumber={parsePositiveInteger(params.image ?? params.slice)}
      initialSeriesId={params.seriesId ?? null}
      initialStudySet={params.studySet ?? null}
    />
  );
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}
