import { DIAGNOSTIC_STUDY_SET_PARAM, normalizeDiagnosticStudySet } from "@/lib/diagnostic-studies";

export const DIAGNOSTIC_COMPARISONS_META_KEY = "diagnosticComparisons:data";
export const DIAGNOSTIC_COMPARISON_SET_PARAM = DIAGNOSTIC_STUDY_SET_PARAM;

const TEST_COMPARISON_SET_RE = /^[a-z0-9-]{1,64}$/;

export type ComparisonPreset =
  | "Subtraction"
  | "Z-matched"
  | "MIP / projection"
  | "T2 nodes"
  | "ADC"
  | "DCAD thin-slab"
  | "Screenshots"
  | "Report panels";

export type ComparisonMatchingStrategy =
  | "imagePositionPatientZ"
  | "manualPairs"
  | "normalizedIndex"
  | "projection"
  | "staticPanel";

export interface DiagnosticComparisonManifest {
  id: string;
  siteSlug?: string;
  label: string;
  leftStudyId: string;
  rightStudyId: string;
  modality: string;
  bodyPart: string;
  createdAt: string;
  sourceArtifacts: string[];
  caveat: string;
  seriesPairs: SeriesPair[];
  reportAnchors: ReportAnchor[];
  precomputedPanels: PrecomputedPanel[];
  metrics?: Record<string, unknown>;
}

export interface SeriesPair {
  id: string;
  label: string;
  preset: ComparisonPreset;
  leftSelector: SeriesSelector;
  rightSelector: SeriesSelector;
  matchingStrategy: ComparisonMatchingStrategy;
  defaultSlice?: number;
  manualPairs?: ManualSlicePair[];
}

export interface SeriesSelector {
  studyId: string;
  seriesKey?: string;
  seriesNumber?: number;
  description?: string;
  zRange?: [number, number];
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  imageCount?: number;
  rows?: number;
  columns?: number;
  exampleFile?: string;
}

export interface ManualSlicePair {
  leftIndex: number;
  rightIndex: number;
  label?: string;
}

export interface ReportAnchor {
  label: string;
  text: string;
  side?: "left" | "right" | "both";
}

export interface PrecomputedPanel {
  label: string;
  href: string;
  note?: string;
}

export interface DiagnosticComparisonsPayload {
  comparisons: DiagnosticComparisonManifest[];
}

export type SeriesSummaryInput = Record<string, SeriesSummaryEntry>;

export interface SeriesSummaryEntry {
  root?: unknown;
  series_number?: unknown;
  description?: unknown;
  count?: unknown;
  rows?: unknown;
  columns?: unknown;
  pixel_spacing?: unknown;
  slice_thickness?: unknown;
  z_range?: unknown;
  example_file?: unknown;
}

interface SeriesSummaryPairSpec {
  id: string;
  leftKey: string;
  rightKey: string;
  label: string;
  preset: ComparisonPreset;
  matchingStrategy: ComparisonMatchingStrategy;
}

const DEFAULT_SERIES_SUMMARY_PAIR_SPECS: SeriesSummaryPairSpec[] = [
  {
    id: "phase-2-subtraction",
    leftKey: "0401_sub_phase2",
    rightKey: "0626_sub_phase2",
    label: "Phase-2 subtraction",
    preset: "Subtraction",
    matchingStrategy: "imagePositionPatientZ",
  },
  {
    id: "z-matched-subtraction",
    leftKey: "0401_sub_phase2",
    rightKey: "0626_sub_phase2",
    label: "Z-matched subtraction",
    preset: "Z-matched",
    matchingStrategy: "imagePositionPatientZ",
  },
  {
    id: "right-subtraction-projection",
    leftKey: "0401_rt_sub",
    rightKey: "0626_rt_sub",
    label: "Right subtraction projection",
    preset: "MIP / projection",
    matchingStrategy: "projection",
  },
  {
    id: "t2-nodal-context",
    leftKey: "0401_t2",
    rightKey: "0626_t2",
    label: "T2 nodal context",
    preset: "T2 nodes",
    matchingStrategy: "imagePositionPatientZ",
  },
  {
    id: "adc-context",
    leftKey: "0401_adc",
    rightKey: "0626_adc",
    label: "ADC context",
    preset: "ADC",
    matchingStrategy: "imagePositionPatientZ",
  },
  {
    id: "dcad-thin-slab",
    leftKey: "0401_dcad_mip",
    rightKey: "0626_dcad_mip",
    label: "DCAD thin-slab MIP",
    preset: "DCAD thin-slab",
    matchingStrategy: "imagePositionPatientZ",
  },
];

export function diagnosticComparisonsTestMetaKey(comparisonSet: string) {
  return `diagnosticComparisons:test:${comparisonSet}`;
}

export function normalizeDiagnosticComparisonSet(value: string | null | undefined) {
  if (process.env.NODE_ENV === "production") return null;
  if (!value || !TEST_COMPARISON_SET_RE.test(value)) return null;
  return value;
}

export function diagnosticComparisonsMetaKeyForSet(
  comparisonSet: string | null | undefined,
) {
  const normalized = normalizeDiagnosticComparisonSet(comparisonSet);
  return normalized
    ? diagnosticComparisonsTestMetaKey(normalized)
    : DIAGNOSTIC_COMPARISONS_META_KEY;
}

export function getDicomCompareHref(
  comparisonId: string,
  comparisonSet?: string | null,
) {
  const params = new URLSearchParams({ comparison: comparisonId });
  const normalized = normalizeDiagnosticStudySet(comparisonSet);
  if (normalized) params.set(DIAGNOSTIC_COMPARISON_SET_PARAM, normalized);
  return `/tools/dicom-compare?${params.toString()}`;
}

export function parseDiagnosticComparisonsPayload(value: string | null | undefined) {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return normalizeDiagnosticComparisonsPayload(parsed).comparisons;
}

export function normalizeDiagnosticComparisonsPayload(
  value: unknown,
): DiagnosticComparisonsPayload {
  const rawComparisons =
    value &&
    typeof value === "object" &&
    Array.isArray((value as { comparisons?: unknown }).comparisons)
      ? (value as { comparisons: unknown[] }).comparisons
      : Array.isArray(value)
        ? value
        : [];

  return {
    comparisons: rawComparisons.map(normalizeDiagnosticComparison).sort(compareComparisons),
  };
}

export function seriesPairsFromSeriesSummary(
  summary: SeriesSummaryInput,
  studies: { leftStudyId: string; rightStudyId: string },
) {
  return DEFAULT_SERIES_SUMMARY_PAIR_SPECS.flatMap((spec) => {
    const left = summary[spec.leftKey];
    const right = summary[spec.rightKey];
    if (!left || !right) return [];

    return [
      {
        id: spec.id,
        label: spec.label,
        preset: spec.preset,
        leftSelector: seriesSelectorFromSummary(left, studies.leftStudyId),
        rightSelector: seriesSelectorFromSummary(right, studies.rightStudyId),
        matchingStrategy: spec.matchingStrategy,
        defaultSlice: defaultSliceFromSummary(left, right),
      } satisfies SeriesPair,
    ];
  });
}

function normalizeDiagnosticComparison(value: unknown): DiagnosticComparisonManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Diagnostic comparison entries must be objects.");
  }

  const record = value as Record<string, unknown>;
  return {
    id: requiredString(record, "id"),
    siteSlug: optionalString(record.siteSlug),
    label: requiredString(record, "label"),
    leftStudyId: requiredString(record, "leftStudyId"),
    rightStudyId: requiredString(record, "rightStudyId"),
    modality: optionalString(record.modality) ?? "MR",
    bodyPart: optionalString(record.bodyPart) ?? "Breast",
    createdAt: optionalString(record.createdAt) ?? new Date(0).toISOString(),
    sourceArtifacts: stringArray(record.sourceArtifacts),
    caveat:
      optionalString(record.caveat) ??
      "Computational comparison and clinical context, not a diagnostic radiology report.",
    seriesPairs: arrayValue(record.seriesPairs).map(normalizeSeriesPair),
    reportAnchors: arrayValue(record.reportAnchors).map(normalizeReportAnchor),
    precomputedPanels: arrayValue(record.precomputedPanels).map(normalizePrecomputedPanel),
    metrics: objectRecord(record.metrics),
  };
}

function normalizeSeriesPair(value: unknown): SeriesPair {
  if (!value || typeof value !== "object") {
    throw new Error("Series pair entries must be objects.");
  }
  const record = value as Record<string, unknown>;
  return {
    id: requiredString(record, "id"),
    label: requiredString(record, "label"),
    preset: normalizePreset(record.preset),
    leftSelector: normalizeSeriesSelector(record.leftSelector),
    rightSelector: normalizeSeriesSelector(record.rightSelector),
    matchingStrategy: normalizeMatchingStrategy(record.matchingStrategy),
    defaultSlice: optionalNumber(record.defaultSlice),
    manualPairs: arrayValue(record.manualPairs).map(normalizeManualPair),
  };
}

function normalizeSeriesSelector(value: unknown): SeriesSelector {
  if (!value || typeof value !== "object") {
    throw new Error("Series selectors must be objects.");
  }
  const record = value as Record<string, unknown>;
  return {
    studyId: requiredString(record, "studyId"),
    seriesKey: optionalString(record.seriesKey),
    seriesNumber: optionalNumber(record.seriesNumber),
    description: optionalString(record.description),
    zRange: numberTuple(record.zRange),
    pixelSpacing: numberTuple(record.pixelSpacing),
    sliceThickness: optionalNumber(record.sliceThickness),
    imageCount: optionalNumber(record.imageCount),
    rows: optionalNumber(record.rows),
    columns: optionalNumber(record.columns),
    exampleFile: optionalString(record.exampleFile),
  };
}

function normalizeManualPair(value: unknown): ManualSlicePair {
  if (!value || typeof value !== "object") {
    throw new Error("Manual slice pair entries must be objects.");
  }
  const record = value as Record<string, unknown>;
  return {
    leftIndex: requiredNumber(record, "leftIndex"),
    rightIndex: requiredNumber(record, "rightIndex"),
    label: optionalString(record.label),
  };
}

function normalizeReportAnchor(value: unknown): ReportAnchor {
  if (!value || typeof value !== "object") {
    throw new Error("Report anchors must be objects.");
  }
  const record = value as Record<string, unknown>;
  const side = optionalString(record.side);
  return {
    label: requiredString(record, "label"),
    text: requiredString(record, "text"),
    side: side === "left" || side === "right" || side === "both" ? side : undefined,
  };
}

function normalizePrecomputedPanel(value: unknown): PrecomputedPanel {
  if (!value || typeof value !== "object") {
    throw new Error("Precomputed panels must be objects.");
  }
  const record = value as Record<string, unknown>;
  return {
    label: requiredString(record, "label"),
    href: requiredString(record, "href"),
    note: optionalString(record.note),
  };
}

function seriesSelectorFromSummary(
  entry: SeriesSummaryEntry,
  studyId: string,
): SeriesSelector {
  return {
    studyId,
    seriesNumber: optionalNumber(entry.series_number),
    description: optionalString(entry.description),
    zRange: numberTuple(entry.z_range),
    pixelSpacing: pixelSpacingTuple(entry.pixel_spacing),
    sliceThickness: optionalNumber(entry.slice_thickness),
    imageCount: optionalNumber(entry.count),
    rows: optionalNumber(entry.rows),
    columns: optionalNumber(entry.columns),
    exampleFile: optionalString(entry.example_file),
  };
}

function defaultSliceFromSummary(left: SeriesSummaryEntry, right: SeriesSummaryEntry) {
  const leftCount = optionalNumber(left.count);
  const rightCount = optionalNumber(right.count);
  const count = Math.min(leftCount ?? Number.MAX_SAFE_INTEGER, rightCount ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isFinite(count) || count === Number.MAX_SAFE_INTEGER || count <= 0) {
    return undefined;
  }
  return Math.floor(count / 2);
}

function normalizePreset(value: unknown): ComparisonPreset {
  const text = optionalString(value);
  const presets = new Set<ComparisonPreset>([
    "Subtraction",
    "Z-matched",
    "MIP / projection",
    "T2 nodes",
    "ADC",
    "DCAD thin-slab",
    "Screenshots",
    "Report panels",
  ]);
  return text && presets.has(text as ComparisonPreset) ? (text as ComparisonPreset) : "Subtraction";
}

function normalizeMatchingStrategy(value: unknown): ComparisonMatchingStrategy {
  const text = optionalString(value);
  const strategies = new Set<ComparisonMatchingStrategy>([
    "imagePositionPatientZ",
    "manualPairs",
    "normalizedIndex",
    "projection",
    "staticPanel",
  ]);
  return text && strategies.has(text as ComparisonMatchingStrategy)
    ? (text as ComparisonMatchingStrategy)
    : "imagePositionPatientZ";
}

function compareComparisons(
  a: DiagnosticComparisonManifest,
  b: DiagnosticComparisonManifest,
) {
  return b.createdAt.localeCompare(a.createdAt) || a.label.localeCompare(b.label);
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = optionalString(record[key]);
  if (!value) throw new Error(`Diagnostic comparison is missing '${key}'.`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string) {
  const value = optionalNumber(record[key]);
  if (value === undefined) {
    throw new Error(`Diagnostic comparison is missing numeric '${key}'.`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberTuple(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = optionalNumber(value[0]);
  const second = optionalNumber(value[1]);
  return first === undefined || second === undefined ? undefined : [first, second];
}

function pixelSpacingTuple(value: unknown): [number, number] | undefined {
  if (Array.isArray(value)) return numberTuple(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return numberTuple(parsed);
  } catch {
    const matches = trimmed.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
    if (matches.length < 2) return undefined;
    return numberTuple(matches);
  }
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown) {
  return arrayValue(value).filter((entry): entry is string => typeof entry === "string");
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
