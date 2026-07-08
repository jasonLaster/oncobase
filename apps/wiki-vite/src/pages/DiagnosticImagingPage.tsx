import {
  getDicomCompareHref,
  type DiagnosticComparisonManifest,
} from "@oncobase/diagnostics/dicom";
import {
  getDicomViewerHref,
  type DiagnosticReportLink,
  type DiagnosticStudiesPayload,
  type DiagnosticStudy,
} from "@oncobase/diagnostics/studies";
import { Columns2, Download, FileText, ImageIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export function DiagnosticImagingPage() {
  const [searchParams] = useSearchParams();
  const studySet = searchParams.get("studySet");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (studySet) params.set("studySet", studySet);
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [studySet]);
  const { data: studiesPayload } = useSWR<DiagnosticStudiesPayload>(
    `/api/diagnostic-studies${query}`,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const { data: comparisonsPayload } = useSWR<{ comparisons: DiagnosticComparisonManifest[] }>(
    `/api/dicom/comparisons${query}`,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const studies = studiesPayload?.studies ?? [];
  const comparisons = comparisonsPayload?.comparisons ?? [];

  return (
    <article className="page-shell diagnostics-imaging-page">
      <header className="diagnostics-imaging-header">
        <div>
          <h1>Imaging</h1>
          <p>Imaging shortcuts with linked reports and source files.</p>
        </div>
        <span className="diagnostics-count">{studies.length} studies</span>
      </header>

      <DiagnosticStudiesTable comparisons={comparisons} studies={studies} studySet={studySet} />
      <section className="diagnostics-mobile-list" data-test-id="diagnostics-mobile-list">
        {studies.map((study) => (
          <DiagnosticStudyCard
            comparisons={comparisons}
            key={study.id}
            study={study}
            studySet={studySet}
          />
        ))}
      </section>
    </article>
  );
}

function DiagnosticStudiesTable({
  comparisons,
  studies,
  studySet,
}: {
  comparisons: DiagnosticComparisonManifest[];
  studies: DiagnosticStudy[];
  studySet: string | null;
}) {
  return (
    <table className="diagnostics-imaging-table" data-test-id="diagnostics-desktop-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Study</th>
          <th scope="col">Type</th>
          <th scope="col">Reports</th>
          <th scope="col">Images</th>
          <th scope="col">Comparisons</th>
          <th scope="col">Download</th>
        </tr>
      </thead>
      <tbody>
        {studies.map((study) => (
          <DiagnosticStudyRow
            comparisons={comparisons}
            key={study.id}
            study={study}
            studySet={studySet}
          />
        ))}
      </tbody>
    </table>
  );
}

function DiagnosticStudyRow({
  comparisons,
  study,
  studySet,
}: {
  comparisons: DiagnosticComparisonManifest[];
  study: DiagnosticStudy;
  studySet: string | null;
}) {
  const reportLinks = study.reportLinks ?? [
    { label: "Pathology report", href: study.pathologyReportHref },
  ];
  const studyComparisons = comparisons.filter(
    (comparison) =>
      comparison.leftStudyId === study.id || comparison.rightStudyId === study.id,
  );

  return (
    <tr>
      <th scope="row">{study.dateLabel}</th>
      <td>
        <div className="diagnostics-study-title">{study.title}</div>
        <div className="diagnostics-study-focus">{study.focus}</div>
      </td>
      <td>{study.modality}</td>
      <td>
        <DiagnosticsMenu
          buttonLabel="Reports"
          icon={<FileText className="size-4" />}
          items={reportLinks}
          menuId={`reports-${study.id}`}
        />
      </td>
      <td>
        <a
          aria-label="Images"
          className="diagnostics-icon-link"
          href={getDicomViewerHref(study.id, studySet)}
        >
          <ImageIcon className="size-4" />
        </a>
      </td>
      <td>
        {studyComparisons.length ? (
          <DiagnosticsMenu
            buttonLabel="Comparisons"
            icon={<Columns2 className="size-4" />}
            items={studyComparisons.map((comparison) => ({
              href: getDicomCompareHref(comparison.id, studySet),
              label: comparison.label,
            }))}
            menuId={`comparisons-${study.id}`}
          />
        ) : (
          <span className="diagnostics-empty-cell">—</span>
        )}
      </td>
      <td>
        {study.downloadHref ? (
          <a className="diagnostics-action-link" href={study.downloadHref}>
            <Download className="size-4" />
            Download source bundle
          </a>
        ) : null}
      </td>
    </tr>
  );
}

function DiagnosticStudyCard({
  comparisons,
  study,
  studySet,
}: {
  comparisons: DiagnosticComparisonManifest[];
  study: DiagnosticStudy;
  studySet: string | null;
}) {
  const studyComparisons = comparisons.filter(
    (comparison) =>
      comparison.leftStudyId === study.id || comparison.rightStudyId === study.id,
  );

  return (
    <article className="diagnostics-study-card">
      <div>
        <h2>{study.title}</h2>
        <p>
          {study.dateLabel} · {study.modality}
        </p>
      </div>
      <div className="diagnostics-study-actions">
        <a href={getDicomViewerHref(study.id, studySet)}>
          <ImageIcon className="size-4" />
          Images
        </a>
        {studyComparisons.map((comparison) => (
          <a href={getDicomCompareHref(comparison.id, studySet)} key={comparison.id}>
            <Columns2 className="size-4" />
            {comparison.label}
          </a>
        ))}
      </div>
    </article>
  );
}

function DiagnosticsMenu({
  buttonLabel,
  icon,
  items,
  menuId,
}: {
  buttonLabel: string;
  icon: ReactNode;
  items: DiagnosticReportLink[];
  menuId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="diagnostics-menu">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {icon}
      </button>
      {open ? (
        <span className="diagnostics-menu-popover" id={menuId} role="menu">
          {items.map((item) => (
            <a href={item.href} key={`${item.label}:${item.href}`} role="menuitem">
              {item.label}
            </a>
          ))}
        </span>
      ) : null}
    </span>
  );
}
