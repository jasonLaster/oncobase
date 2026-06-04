export interface DiagnosticBiopsy {
  id: string;
  shortLabel: string;
  title: string;
  dateLabel: string;
  isoDate: string;
  modality: string;
  focus: string;
  directoryIncludes: string;
  pathologySourceHref: string;
  pathologyPdfHref?: string;
}

export const DIAGNOSTIC_BIOPSIES: DiagnosticBiopsy[] = [
  {
    id: "biopsy-2026-04-10",
    shortLabel: "4/10",
    title: "April 10 biopsy",
    dateLabel: "Apr 10, 2026",
    isoDate: "2026-04-10",
    modality: "US",
    focus: "Biopsy ultrasound stack",
    directoryIncludes: "4-10 biopsy",
    pathologySourceHref:
      "/sources/diagnostics/04-10-kernis-path-report/04-10-kernis-path-report",
    pathologyPdfHref:
      "/api/file?path=sources%2Fdiagnostics%2F04-10-kernis-path-report%2F04-10-kernis-path-report.pdf",
  },
  {
    id: "biopsy-2026-03-23",
    shortLabel: "3/23",
    title: "March 23 axilla biopsy",
    dateLabel: "Mar 23, 2026",
    isoDate: "2026-03-23",
    modality: "US",
    focus: "Axilla biopsy ultrasound stack",
    directoryIncludes: "3-23 - US Axilla biopsy",
    pathologySourceHref: "/sources/diagnostics/03-23-us-axilla-core-biopsy",
  },
  {
    id: "biopsy-2026-03-13",
    shortLabel: "3/13",
    title: "March 13 biopsy",
    dateLabel: "Mar 13, 2026",
    isoDate: "2026-03-13",
    modality: "US",
    focus: "Biopsy ultrasound stack",
    directoryIncludes: "3-13 - Biopsy",
    pathologySourceHref: "/sources/diagnostics/03-13-breast-biopsy-report",
    pathologyPdfHref:
      "/api/file?path=sources%2Fdiagnostics%2F03-13-breast-biopsy-report.pdf",
  },
];

export function getDiagnosticBiopsyById(id: string | null | undefined) {
  if (!id) return null;
  return DIAGNOSTIC_BIOPSIES.find((biopsy) => biopsy.id === id) ?? null;
}

export function getDicomViewerHref(biopsyId: string) {
  return `/tools/dicom-viewer?id=${encodeURIComponent(biopsyId)}`;
}
