import { DicomViewerClient } from "./viewer-client";

export const metadata = {
  title: "DICOM Viewer",
};

export default function DicomViewerPage() {
  return <DicomViewerClient />;
}
