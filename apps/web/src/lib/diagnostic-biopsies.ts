export interface DiagnosticBiopsy {
  id: string;
  shortLabel: string;
  title: string;
  dateLabel: string;
  isoDate: string;
  modality: string;
  focus: string;
  directoryIncludes: string;
  pathologyReportHref: string;
  reportLinks?: DiagnosticReportLink[];
}

export interface DiagnosticReportLink {
  label: string;
  href: string;
}

export const DIAGNOSTIC_BIOPSIES: DiagnosticBiopsy[] = [
  {
    id: "diagnostic-2026-04-01-breast-mri",
    shortLabel: "4/1",
    title: "April 1 breast MRI",
    dateLabel: "Apr 1, 2026",
    isoDate: "2026-04-01",
    modality: "MR",
    focus: "Breast MRI stack",
    directoryIncludes: "04-01-breast-mri",
    pathologyReportHref: fileAssetHref(
      "diagnostics/viewer-upload/04-01-breast-mri/reports/04-01-breast-mri.pdf",
    ),
    reportLinks: [
      {
        label: "MRI report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/04-01-breast-mri/reports/04-01-breast-mri.pdf",
        ),
      },
      {
        label: "Breast biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/04-01-breast-mri/reports/03-13-breast-biopsy-report.pdf",
        ),
      },
      {
        label: "Axilla biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/04-01-breast-mri/reports/03-23-us-axilla-core-biopsy.pdf",
        ),
      },
      {
        label: "Download assets",
        href: fileAssetHref(
          "diagnostics/viewer-upload/04-01-breast-mri/source-files.zip",
        ),
      },
    ],
  },
  {
    id: "diagnostic-2026-03-27-petct",
    shortLabel: "3/27",
    title: "March 27 PET/CT",
    dateLabel: "Mar 27, 2026",
    isoDate: "2026-03-27",
    modality: "PET/CT",
    focus: "PET/CT stack",
    directoryIncludes: "03-27-petct",
    pathologyReportHref: fileAssetHref(
      "diagnostics/viewer-upload/03-27-petct/report.pdf",
    ),
    reportLinks: [
      {
        label: "PET/CT report",
        href: fileAssetHref("diagnostics/viewer-upload/03-27-petct/report.pdf"),
      },
      {
        label: "Breast biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/03-27-petct/reports/03-13-breast-biopsy-report.pdf",
        ),
      },
      {
        label: "Axilla biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/03-27-petct/reports/03-23-us-axilla-core-biopsy.pdf",
        ),
      },
      {
        label: "Download assets",
        href: fileAssetHref("diagnostics/viewer-upload/03-27-petct/source-files.zip"),
      },
    ],
  },
  {
    id: "diagnostic-2026-03-20-ultrasound",
    shortLabel: "3/20",
    title: "March 20 ultrasound",
    dateLabel: "Mar 20, 2026",
    isoDate: "2026-03-20",
    modality: "US",
    focus: "Breast ultrasound stack",
    directoryIncludes: "03-20-ultrasound",
    pathologyReportHref: fileAssetHref(
      "diagnostics/viewer-upload/03-20-ultrasound/reports/03-23-us-axilla-core-biopsy.pdf",
    ),
    reportLinks: [
      {
        label: "Axilla biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/03-20-ultrasound/reports/03-23-us-axilla-core-biopsy.pdf",
        ),
      },
      {
        label: "Breast biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/03-20-ultrasound/reports/03-13-breast-biopsy-report.pdf",
        ),
      },
      {
        label: "Download assets",
        href: fileAssetHref("diagnostics/viewer-upload/03-20-ultrasound/source-files.zip"),
      },
    ],
  },
  {
    id: "biopsy-2026-04-10",
    shortLabel: "4/10",
    title: "April 10 biopsy",
    dateLabel: "Apr 10, 2026",
    isoDate: "2026-04-10",
    modality: "Biopsy",
    focus: "Biopsy ultrasound stack",
    directoryIncludes: "4-10 biopsy",
    pathologyReportHref:
      "/api/file?path=sources%2Fdiagnostics%2F04-10-kernis-path-report%2F04-10-kernis-path-report.pdf",
  },
  {
    id: "diagnostic-2026-02-20-ultrasound",
    shortLabel: "2/20",
    title: "February 20 ultrasound",
    dateLabel: "Feb 20, 2026",
    isoDate: "2026-02-20",
    modality: "US",
    focus: "Breast ultrasound stack",
    directoryIncludes: "02-20-ultrasound",
    pathologyReportHref: fileAssetHref(
      "diagnostics/viewer-upload/02-20-ultrasound/reports/03-13-breast-biopsy-report.pdf",
    ),
    reportLinks: [
      {
        label: "Breast biopsy report",
        href: fileAssetHref(
          "diagnostics/viewer-upload/02-20-ultrasound/reports/03-13-breast-biopsy-report.pdf",
        ),
      },
      {
        label: "Download assets",
        href: fileAssetHref("diagnostics/viewer-upload/02-20-ultrasound/source-files.zip"),
      },
    ],
  },
  {
    id: "biopsy-2026-03-23",
    shortLabel: "3/23",
    title: "March 23 axilla biopsy",
    dateLabel: "Mar 23, 2026",
    isoDate: "2026-03-23",
    modality: "Biopsy",
    focus: "Axilla biopsy ultrasound stack",
    directoryIncludes: "3-23 - US Axilla biopsy",
    pathologyReportHref: "/sources/diagnostics/03-23-us-axilla-core-biopsy",
  },
  {
    id: "biopsy-2026-03-13",
    shortLabel: "3/13",
    title: "March 13 biopsy",
    dateLabel: "Mar 13, 2026",
    isoDate: "2026-03-13",
    modality: "Biopsy",
    focus: "Biopsy ultrasound stack",
    directoryIncludes: "3-13 - Biopsy",
    pathologyReportHref:
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

function fileAssetHref(path: string) {
  return `/api/file?path=${encodeURIComponent(path)}`;
}
