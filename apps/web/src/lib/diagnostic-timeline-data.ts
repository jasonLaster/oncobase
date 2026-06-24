import {
  getDiagnosticBiopsyById,
  getDicomViewerHref,
} from "@/lib/diagnostic-biopsies";

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
): DiagnosticTimelineData {
  const rangeEnd = maxIsoDate(timeline.metadata.range.end, today);

  return enrichDiagnosticTimeline({
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
  });
}

export function enrichDiagnosticTimeline(
  timeline: DiagnosticTimelineData,
): DiagnosticTimelineData {
  return {
    ...timeline,
    sleeves: timeline.sleeves.map((sleeve) => ({
      ...sleeve,
      tracks: sleeve.tracks.map((track) => ({
        ...track,
        events: track.events.map((event) => ({
          ...event,
          links: mergeLinks(event.links ?? [], diagnosticLinksForEvent(event)),
        })),
      })),
    })),
  };
}

export function countDiagnosticTimelineEvents(data: DiagnosticTimelineData) {
  return data.sleeves.reduce(
    (total, sleeve) =>
      total +
      sleeve.tracks.reduce((trackTotal, track) => trackTotal + track.events.length, 0),
    0,
  );
}

function diagnosticLinksForEvent(event: DiagnosticTimelineEvent): DiagnosticTimelineLink[] {
  const biopsy = getDiagnosticBiopsyById(event.diagnosticId);
  if (!biopsy) return [];

  const reportLinks = biopsy.reportLinks ?? [
    { label: "Report", href: biopsy.pathologyReportHref },
  ];

  return [
    { label: "Diagnostics", href: "/diagnostics" },
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
