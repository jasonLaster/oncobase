import {
  getDicomViewerHref,
  type DiagnosticStudy,
} from "../studies/data.ts";

export type DiagnosticTimelineStatus = "reported" | "flagged" | "planned";
export type DiagnosticTimelineTrackKind = "events" | "series";
export type DiagnosticTimelineScale = "linear" | "log";

export interface DiagnosticTimelineLink {
  label: string;
  href: string;
}

export interface DiagnosticTimelineEvent {
  id: string;
  date: string;
  endDate?: string;
  label: string;
  result: string;
  status: DiagnosticTimelineStatus;
  value?: number;
  valueLabel?: string;
  diagnosticId?: string;
  details?: string[];
  links?: DiagnosticTimelineLink[];
}

export interface DiagnosticTimelineTrack {
  id: string;
  label: string;
  kind: DiagnosticTimelineTrackKind;
  color: string;
  unit?: string;
  scale?: DiagnosticTimelineScale;
  valueDomain?: [number, number];
  events: DiagnosticTimelineEvent[];
}

export interface DiagnosticTimelineSleeve {
  id: string;
  label: string;
  description: string;
  tone: string;
  tracks: DiagnosticTimelineTrack[];
}

export interface DiagnosticTimelineData {
  metadata: {
    title: string;
    asOf: string;
    range: {
      start: string;
      end: string;
    };
    defaultRange?: {
      start: string;
      end: string;
    };
    sourcePages: DiagnosticTimelineLink[];
  };
  sleeves: DiagnosticTimelineSleeve[];
}

const DEFAULT_WINDOW_START = "2026-04-02";
const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export function prepareDiagnosticTimeline(
  timeline: DiagnosticTimelineData,
  today = todayInPacificTime(),
  diagnosticStudies: DiagnosticStudy[] = [],
): DiagnosticTimelineData {
  const rangeEnd = maxIsoDate(timeline.metadata.range.end, today);

  return enrichDiagnosticTimeline(
    {
      ...timeline,
      metadata: {
        ...timeline.metadata,
        asOf: today,
        range: {
          ...timeline.metadata.range,
          end: rangeEnd,
        },
        defaultRange: {
          start: DEFAULT_WINDOW_START,
          end: today,
        },
      },
    },
    diagnosticStudies,
  );
}

export function prepareDiagnosticTimelineResponse(
  value: string,
  diagnosticStudies: DiagnosticStudy[] = [],
  today?: string,
) {
  return prepareDiagnosticTimeline(
    JSON.parse(value) as DiagnosticTimelineData,
    today,
    diagnosticStudies,
  );
}

export function enrichDiagnosticTimeline(
  timeline: DiagnosticTimelineData,
  diagnosticStudies: DiagnosticStudy[] = [],
): DiagnosticTimelineData {
  const timelineWithDiagnosticStudies = appendDiagnosticStudyEvents(
    timeline,
    diagnosticStudies,
  );

  return {
    ...timelineWithDiagnosticStudies,
    sleeves: timelineWithDiagnosticStudies.sleeves.map((sleeve) => ({
      ...sleeve,
      tracks: sleeve.tracks.map((track) => ({
        ...track,
        events: track.events.map((event) => ({
          ...event,
          links: mergeLinks(
            event.links ?? [],
            diagnosticLinksForEvent(event, diagnosticStudies),
          ),
        })),
      })),
    })),
  };
}

function appendDiagnosticStudyEvents(
  timeline: DiagnosticTimelineData,
  diagnosticStudies: DiagnosticStudy[],
): DiagnosticTimelineData {
  if (!diagnosticStudies.length) return timeline;

  const existingDiagnosticIds = new Set(
    timeline.sleeves.flatMap((sleeve) =>
      sleeve.tracks.flatMap((track) =>
        track.events.flatMap((event) =>
          event.diagnosticId ? [event.diagnosticId] : [],
        ),
      ),
    ),
  );
  const missingStudies = diagnosticStudies.filter(
    (study) => !existingDiagnosticIds.has(study.id) && isImagingStudy(study),
  );
  if (!missingStudies.length) return timeline;

  return {
    ...timeline,
    sleeves: timeline.sleeves.map((sleeve) => {
      if (sleeve.id !== "imaging") return sleeve;
      return {
        ...sleeve,
        tracks: sleeve.tracks.map((track) => {
          const studyEvents = missingStudies
            .filter((study) => track.id === trackIdForStudy(study))
            .map(eventForDiagnosticStudy);
          if (!studyEvents.length) return track;
          return {
            ...track,
            events: [...track.events, ...studyEvents].sort((a, b) =>
              a.date.localeCompare(b.date),
            ),
          };
        }),
      };
    }),
  };
}

function eventForDiagnosticStudy(study: DiagnosticStudy): DiagnosticTimelineEvent {
  return {
    id: `diagnostic-study-${study.id}`,
    date: study.isoDate,
    label: study.title.replace(
      /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2} /,
      "",
    ),
    result: study.focus,
    status: "reported",
    diagnosticId: study.id,
    details: ["DICOM stack and report metadata are available from Convex."],
  };
}

function isImagingStudy(study: DiagnosticStudy) {
  return ["MR", "MRI", "PET/CT", "PT", "US", "ULTRASOUND"].includes(
    study.modality.toUpperCase(),
  );
}

function trackIdForStudy(study: DiagnosticStudy) {
  const modality = study.modality.toUpperCase();
  if (modality.includes("PET") || modality === "PT") return "petct";
  if (modality.includes("MR")) return "mri";
  if (modality.includes("US") || modality.includes("ULTRASOUND")) {
    return "us-mammogram";
  }
  return "mri";
}

export function countDiagnosticTimelineEvents(data: DiagnosticTimelineData) {
  return data.sleeves.reduce(
    (total, sleeve) =>
      total +
      sleeve.tracks.reduce((trackTotal, track) => trackTotal + track.events.length, 0),
    0,
  );
}

function diagnosticLinksForEvent(
  event: DiagnosticTimelineEvent,
  diagnosticStudies: DiagnosticStudy[],
): DiagnosticTimelineLink[] {
  const biopsy = diagnosticStudies.find((study) => study.id === event.diagnosticId);
  if (!biopsy) return [];

  const reportLinks = biopsy.reportLinks ?? [
    { label: "Report", href: biopsy.pathologyReportHref },
  ];

  return [
    { label: "Imaging", href: "/diagnostics/imaging" },
    ...reportLinks,
    { label: "View images", href: getDicomViewerHref(biopsy.id) },
  ];
}

function mergeLinks(
  baseLinks: DiagnosticTimelineLink[],
  appendedLinks: DiagnosticTimelineLink[],
) {
  const seen = new Set<string>();
  const links: DiagnosticTimelineLink[] = [];

  for (const link of [...baseLinks, ...appendedLinks]) {
    const key = `${link.label}:${link.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }

  return links;
}

function todayInPacificTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date());
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}

function maxIsoDate(a: string, b: string) {
  return a > b ? a : b;
}
