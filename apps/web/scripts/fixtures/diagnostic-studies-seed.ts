import type { DiagnosticStudiesPayload } from "../../src/lib/diagnostic-studies";

export const diagnosticStudiesSeed = {
  studies: [
    {
      id: "diagnostic-2026-06-26-breast-mri",
      shortLabel: "6/26",
      title: "June 26 breast MRI",
      dateLabel: "Jun 26, 2026",
      isoDate: "2026-06-26",
      modality: "MR",
      focus: "Breast MRI stack",
      directoryIncludes: "06-26-breast-mri",
      pathologyReportHref: fileAssetHref(
        "diagnostics/viewer-upload/06-26-breast-mri/report.pdf",
      ),
      reportLinks: [
        {
          label: "MRI report",
          href: fileAssetHref("diagnostics/viewer-upload/06-26-breast-mri/report.pdf"),
        },
      ],
      downloadHref: fileAssetHref(
        "diagnostics/viewer-upload/06-26-breast-mri/source-files.zip",
      ),
    },
    {
      id: "diagnostic-2026-06-10-petct",
      shortLabel: "6/10",
      title: "June 10 PET/CT",
      dateLabel: "Jun 10, 2026",
      isoDate: "2026-06-10",
      modality: "PET/CT",
      focus: "PET/CT stack",
      directoryIncludes: "05-10-petct",
      pathologyReportHref: sourcePageHref("06-10-cu-grip-petct"),
      reportLinks: [
        {
          label: "PET/CT report",
          href: sourcePageHref("06-10-cu-grip-petct"),
        },
      ],
      downloadHref: fileAssetHref("diagnostics/viewer-upload/05-10-petct/source-files.zip"),
    },
    {
      id: "diagnostic-2026-04-01-breast-mri",
      shortLabel: "4/1",
      title: "April 1 breast MRI",
      dateLabel: "Apr 1, 2026",
      isoDate: "2026-04-01",
      modality: "MR",
      focus: "Breast MRI stack",
      directoryIncludes: "04-01-breast-mri",
      pathologyReportHref: sourcePdfHref("401-breast-mri.pdf"),
      reportLinks: [
        {
          label: "MRI report",
          href: sourcePdfHref("401-breast-mri.pdf"),
        },
        {
          label: "Breast biopsy report",
          href: sourcePdfHref("03-13-breast-biopsy-report.pdf"),
        },
        {
          label: "Axilla biopsy report",
          href: sourcePageHref("03-23-us-axilla-core-biopsy"),
        },
      ],
      downloadHref: fileAssetHref(
        "diagnostics/viewer-upload/04-01-breast-mri/source-files.zip",
      ),
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
      pathologyReportHref: sourcePageHref("03-27-petct"),
      reportLinks: [
        {
          label: "PET/CT report",
          href: sourcePageHref("03-27-petct"),
        },
        {
          label: "Breast biopsy report",
          href: sourcePdfHref("03-13-breast-biopsy-report.pdf"),
        },
        {
          label: "Axilla biopsy report",
          href: sourcePageHref("03-23-us-axilla-core-biopsy"),
        },
      ],
      downloadHref: fileAssetHref("diagnostics/viewer-upload/03-27-petct/source-files.zip"),
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
      pathologyReportHref: sourcePageHref("03-20-ultrasound"),
      reportLinks: [
        {
          label: "Ultrasound report",
          href: sourcePageHref("03-20-ultrasound"),
        },
        {
          label: "Axilla biopsy report",
          href: sourcePageHref("03-23-us-axilla-core-biopsy"),
        },
        {
          label: "Breast biopsy report",
          href: sourcePdfHref("03-13-breast-biopsy-report.pdf"),
        },
      ],
      downloadHref: fileAssetHref("diagnostics/viewer-upload/03-20-ultrasound/source-files.zip"),
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
      pathologyReportHref: fileAssetHref(
        "sources/diagnostics/04-10-kernis-path-report/04-10-kernis-path-report.pdf",
      ),
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
      pathologyReportHref: sourcePageHref("02-20-ultrasound"),
      reportLinks: [
        {
          label: "Ultrasound report",
          href: sourcePageHref("02-20-ultrasound"),
        },
        {
          label: "Breast biopsy report",
          href: sourcePdfHref("03-13-breast-biopsy-report.pdf"),
        },
      ],
      downloadHref: fileAssetHref("diagnostics/viewer-upload/02-20-ultrasound/source-files.zip"),
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
      pathologyReportHref: sourcePageHref("03-23-us-axilla-core-biopsy"),
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
      pathologyReportHref: fileAssetHref("sources/diagnostics/03-13-breast-biopsy-report.pdf"),
    },
  ],
} satisfies DiagnosticStudiesPayload;

function fileAssetHref(path: string) {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

function sourcePageHref(slug: string) {
  return `/sources/diagnostics/${slug}`;
}

function sourcePdfHref(fileName: string) {
  return fileAssetHref(`sources/diagnostics/${fileName}`);
}
