export interface DiagnosticStudy {
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
  downloadHref?: string;
}

export interface DiagnosticReportLink {
  label: string;
  href: string;
}

export interface DiagnosticStudiesPayload {
  studies: DiagnosticStudy[];
}

export const DIAGNOSTIC_STUDIES_META_KEY = "diagnosticStudies:data";
export const DIAGNOSTIC_STUDY_SET_PARAM = "studySet";

const TEST_STUDY_SET_RE = /^[a-z0-9-]{1,64}$/;

export function diagnosticStudiesTestMetaKey(studySet: string) {
  return `diagnosticStudies:test:${studySet}`;
}

export function normalizeDiagnosticStudySet(value: string | null | undefined) {
  if (process.env.NODE_ENV === "production") return null;
  if (!value || !TEST_STUDY_SET_RE.test(value)) return null;
  return value;
}

export function diagnosticStudiesMetaKeyForSet(studySet: string | null | undefined) {
  const normalized = normalizeDiagnosticStudySet(studySet);
  return normalized
    ? diagnosticStudiesTestMetaKey(normalized)
    : DIAGNOSTIC_STUDIES_META_KEY;
}

export function getDicomViewerHref(studyId: string, studySet?: string | null) {
  const params = new URLSearchParams({ id: studyId });
  const normalized = normalizeDiagnosticStudySet(studySet);
  if (normalized) params.set(DIAGNOSTIC_STUDY_SET_PARAM, normalized);
  return `/tools/dicom-viewer?${params.toString()}`;
}

export function getPrimaryReportLink(study: DiagnosticStudy) {
  return study.reportLinks?.[0] ?? {
    label: "Pathology report",
    href: study.pathologyReportHref,
  };
}

export function sortDiagnosticStudies(studies: DiagnosticStudy[]) {
  return [...studies].sort((a, b) => b.isoDate.localeCompare(a.isoDate));
}

export function parseDiagnosticStudiesPayload(value: string | null | undefined) {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return normalizeDiagnosticStudiesPayload(parsed).studies;
}

export function normalizeDiagnosticStudiesPayload(
  value: unknown,
): DiagnosticStudiesPayload {
  const rawStudies =
    value && typeof value === "object" && Array.isArray((value as { studies?: unknown }).studies)
      ? (value as { studies: unknown[] }).studies
      : Array.isArray(value)
        ? value
        : [];

  return {
    studies: sortDiagnosticStudies(rawStudies.map(normalizeDiagnosticStudy)),
  };
}

function normalizeDiagnosticStudy(value: unknown): DiagnosticStudy {
  if (!value || typeof value !== "object") {
    throw new Error("Diagnostic study entries must be objects.");
  }

  const record = value as Record<string, unknown>;
  const id = requiredString(record, "id");
  const isoDate = requiredString(record, "isoDate");
  const title = requiredString(record, "title");

  return {
    id,
    shortLabel: optionalString(record.shortLabel) ?? shortDateLabel(isoDate),
    title,
    dateLabel: optionalString(record.dateLabel) ?? formatDateLabel(isoDate),
    isoDate,
    modality: requiredString(record, "modality"),
    focus: requiredString(record, "focus"),
    directoryIncludes: requiredString(record, "directoryIncludes"),
    pathologyReportHref: requiredString(record, "pathologyReportHref"),
    reportLinks: normalizeReportLinks(record.reportLinks),
    downloadHref: optionalString(record.downloadHref),
  };
}

function normalizeReportLinks(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const links = value.map((link) => {
    if (!link || typeof link !== "object") {
      throw new Error("Diagnostic report links must be objects.");
    }
    const record = link as Record<string, unknown>;
    return {
      label: requiredString(record, "label"),
      href: requiredString(record, "href"),
    };
  });
  return links.length ? links : undefined;
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = optionalString(record[key]);
  if (!value) throw new Error(`Diagnostic study is missing '${key}'.`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function shortDateLabel(isoDate: string) {
  const [, month, day] = isoDate.split("-");
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (!Number.isFinite(monthNumber) || !Number.isFinite(dayNumber)) return isoDate;
  return `${monthNumber}/${dayNumber}`;
}

function formatDateLabel(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
