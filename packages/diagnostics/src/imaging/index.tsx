"use client";

import { Columns2, Download, FileText, ImageIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  getDicomCompareHref,
  type DiagnosticComparisonManifest,
} from "../dicom/comparisons.ts";
import {
  getDicomViewerHref,
  type DiagnosticReportLink,
  type DiagnosticStudy,
} from "../studies/data.ts";
import type { PathologySlide } from "../pathology/model.ts";

export interface DiagnosticImagingProps {
  comparisons: DiagnosticComparisonManifest[];
  studies: DiagnosticStudy[];
  pathologySlides?: PathologySlide[];
  pathologyError?: boolean;
  onRetryPathology?: () => void;
  studySet?: string | null;
}

interface ImagingEntry {
  id: string;
  title: string;
  dateLabel: string;
  isoDate: string;
  modality: string;
  focus: string;
  viewerHref: string;
  reportLinks: DiagnosticReportLink[];
  comparisonLinks: DiagnosticReportLink[];
  downloadHref?: string;
}

const scanDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

function getScanDate(scanDate?: string) {
  const match = scanDate?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const isoDate = match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (isoDate && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(isoDate)) {
    return { isoDate, dateLabel: `${scanDateFormatter.format(date)} (scan)` };
  }
  return { isoDate: "", dateLabel: scanDate ? `${scanDate} (scan)` : "Scan date unavailable" };
}

function getPathologyHref(slideId: string, compareId?: string) {
  const params = new URLSearchParams({ slide: slideId });
  if (compareId) params.set("compare", compareId);
  return `/tools/pathology-viewer?${params.toString()}`;
}

export function DiagnosticImaging({
  comparisons,
  studies,
  pathologySlides = [],
  pathologyError = false,
  onRetryPathology,
  studySet = null,
}: DiagnosticImagingProps) {
  const entries: ImagingEntry[] = [
    ...studies.map((study) => ({
      ...study,
      viewerHref: getDicomViewerHref(study.id, studySet),
      reportLinks: study.reportLinks ?? [{ label: "Pathology report", href: study.pathologyReportHref }],
      comparisonLinks: comparisons
        .filter((comparison) => comparison.leftStudyId === study.id || comparison.rightStudyId === study.id)
        .map((comparison) => ({ href: getDicomCompareHref(comparison.id, studySet), label: comparison.label })),
    })),
    ...pathologySlides.map((slide) => ({
      id: slide.slideId,
      title: `${slide.stain} slide · ${slide.accession ?? slide.label}`,
      ...getScanDate(slide.scanDate),
      modality: slide.stain,
      focus: `Whole-slide microscopy${slide.objectivePower ? ` · ${slide.objectivePower}× scan` : ""}`,
      viewerHref: getPathologyHref(slide.slideId),
      reportLinks: [],
      comparisonLinks: pathologySlides
        .filter((other) => other.slideId !== slide.slideId)
        .map((other) => ({ href: getPathologyHref(slide.slideId, other.slideId), label: other.accession ?? other.label })),
    })),
  ].sort((left, right) => right.isoDate.localeCompare(left.isoDate));

  return (
    <article className="page-shell diagnostics-imaging-page">
      <header className="diagnostics-imaging-header">
        <div>
          <h1>Imaging</h1>
          <p>Imaging and pathology slides with linked reports and source files.</p>
        </div>
        <span className="diagnostics-count">{entries.length} studies</span>
      </header>

      {pathologyError ? (
        <p className="diagnostics-load-error" role="alert">
          H&E slides could not load. {onRetryPathology ? <button onClick={onRetryPathology} type="button">Retry</button> : null}
        </p>
      ) : null}
      <DiagnosticStudiesTable studies={entries} />
      <section className="diagnostics-mobile-list" data-test-id="diagnostics-mobile-list">
        {entries.map((study) => (
          <DiagnosticStudyCard
            key={study.id}
            study={study}
          />
        ))}
      </section>
    </article>
  );
}

function DiagnosticStudiesTable({
  studies,
}: {
  studies: ImagingEntry[];
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
            key={study.id}
            study={study}
          />
        ))}
      </tbody>
    </table>
  );
}

function DiagnosticStudyRow({
  study,
}: {
  study: ImagingEntry;
}) {
  return (
    <tr>
      <th scope="row">{study.dateLabel}</th>
      <td>
        <div className="diagnostics-study-title">{study.title}</div>
        <div className="diagnostics-study-focus">{study.focus}</div>
      </td>
      <td>{study.modality}</td>
      <td>
        {study.reportLinks.length ? <DiagnosticsMenu
          buttonLabel="Reports"
          icon={<FileText className="size-4" />}
          items={study.reportLinks}
          menuId={`reports-${study.id}`}
        /> : <span className="diagnostics-empty-cell">—</span>}
      </td>
      <td>
        <a
          aria-label="Images"
          className="diagnostics-icon-link"
          href={study.viewerHref}
        >
          <ImageIcon className="size-4" />
        </a>
      </td>
      <td>
        {study.comparisonLinks.length ? (
          <DiagnosticsMenu
            buttonLabel="Comparisons"
            icon={<Columns2 className="size-4" />}
            items={study.comparisonLinks}
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
  study,
}: {
  study: ImagingEntry;
}) {
  return (
    <article className="diagnostics-study-card">
      <div>
        <h2>{study.title}</h2>
        <p>
          {study.dateLabel} · {study.modality}
        </p>
      </div>
      <div className="diagnostics-study-actions">
        <a href={study.viewerHref}>
          <ImageIcon className="size-4" />
          Images
        </a>
        {study.comparisonLinks.map((comparison) => (
          <a href={comparison.href} key={comparison.href}>
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
