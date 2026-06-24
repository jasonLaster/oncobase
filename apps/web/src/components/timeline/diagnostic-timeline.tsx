"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  RotateCcw,
  Search,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  DiagnosticTimelineData,
  DiagnosticTimelineEvent,
  DiagnosticTimelineLink,
  DiagnosticTimelineSleeve,
  DiagnosticTimelineTrack,
} from "@/lib/diagnostic-timeline-data";
import { cn } from "@/lib/utils";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_RANGE_MS = 10 * MS_PER_DAY;
const TRACK_HEIGHT = 48;
const SERIES_TOP = 8;
const SERIES_BOTTOM = 38;
const PLOT_MIN_WIDTH = 920;
const MONTH_TICK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const WEEK_TICK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const RANGE_START_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const RANGE_END_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

interface TimelineEventRef {
  event: DiagnosticTimelineEvent;
  sleeve: DiagnosticTimelineSleeve;
  track: DiagnosticTimelineTrack;
}

interface DateRange {
  start: number;
  end: number;
}

interface TimelineTick {
  label: string;
  time: number;
}

interface TooltipAnchor {
  eventId: string;
  x: number;
  y: number;
  vertical: "above" | "below";
  horizontal: "left" | "center" | "right";
}

type DragState =
  | {
      mode: "zoom";
      startX: number;
      currentX: number;
    }
  | {
      mode: "pan";
      startX: number;
      currentX: number;
      initialRange: DateRange;
    };

interface TimelineState {
  activeEventId: string | null;
  collapsedSleeves: Set<string>;
  drag: DragState | null;
  filter: string;
  tooltipAnchor: TooltipAnchor | null;
  visibleRange: DateRange;
}

type TimelineAction =
  | { type: "hideEvent"; eventId?: string }
  | { type: "setDrag"; drag: DragState | null }
  | { type: "setFilter"; filter: string }
  | { type: "setTooltipAnchor"; anchor: TooltipAnchor | null }
  | { type: "setVisibleRange"; range: DateRange | ((range: DateRange) => DateRange) }
  | { type: "showEvent"; anchor: TooltipAnchor; eventId: string }
  | { type: "toggleSleeve"; sleeveId: string };

export function DiagnosticTimeline({ data }: { data: DiagnosticTimelineData }) {
  const fullRange = useMemo(
    () => ({
      start: toTime(data.metadata.range.start),
      end: toTime(data.metadata.range.end),
    }),
    [data.metadata.range.end, data.metadata.range.start],
  );
  const defaultVisibleRange = useMemo(
    () =>
      clampRange(
        {
          start: toTime(data.metadata.defaultRange?.start ?? data.metadata.range.start),
          end: toTime(data.metadata.defaultRange?.end ?? data.metadata.range.end),
        },
        fullRange,
      ),
    [
      data.metadata.defaultRange?.end,
      data.metadata.defaultRange?.start,
      data.metadata.range.end,
      data.metadata.range.start,
      fullRange,
    ],
  );
  const [state, dispatch] = useReducer(
    timelineReducer,
    defaultVisibleRange,
    (visibleRange): TimelineState => ({
      activeEventId: null,
      collapsedSleeves: new Set(),
      drag: null,
      filter: "",
      tooltipAnchor: null,
      visibleRange,
    }),
  );
  const {
    activeEventId,
    collapsedSleeves,
    drag,
    filter,
    tooltipAnchor,
    visibleRange,
  } = state;
  const tooltipHideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allEventRefs = useMemo(() => flattenEvents(data.sleeves), [data.sleeves]);
  const activeEvent = activeEventId
    ? allEventRefs.find((item) => item.event.id === activeEventId) ?? null
    : null;

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredSleeves = useMemo(() => {
    if (!normalizedFilter) return data.sleeves;

    const sleeves: DiagnosticTimelineSleeve[] = [];
    for (const sleeve of data.sleeves) {
      const tracks: DiagnosticTimelineTrack[] = [];
      for (const track of sleeve.tracks) {
        const events = track.events.filter((event) =>
          eventMatchesFilter(event, track, sleeve, normalizedFilter),
        );
        if (events.length > 0) {
          tracks.push({ ...track, events });
        }
      }
      if (tracks.length > 0) {
        sleeves.push({ ...sleeve, tracks });
      }
    }
    return sleeves;
  }, [data.sleeves, normalizedFilter]);

  const visibleEventCount = filteredSleeves.reduce(
    (total, sleeve) =>
      total +
      sleeve.tracks.reduce((trackTotal, track) => trackTotal + track.events.length, 0),
    0,
  );
  const monthTicks = useMemo(
    () => buildMonthTicks(visibleRange.start, visibleRange.end),
    [visibleRange.end, visibleRange.start],
  );
  const weekTicks = useMemo(
    () => buildWeekTicks(visibleRange.start, visibleRange.end),
    [visibleRange.end, visibleRange.start],
  );
  const allEventDots = useMemo(() => flattenEvents(data.sleeves), [data.sleeves]);
  const activeX = activeEvent
    ? percentForDate(activeEvent.event.date, visibleRange)
    : null;

  const clearTooltipHide = useCallback(() => {
    if (tooltipHideTimeout.current) {
      clearTimeout(tooltipHideTimeout.current);
      tooltipHideTimeout.current = null;
    }
  }, []);

  const hideTimelineEvent = useCallback(
    (eventId?: string) => {
      clearTooltipHide();
      dispatch({ type: "hideEvent", eventId });
    },
    [clearTooltipHide],
  );

  const scheduleHideTimelineEvent = useCallback(
    (eventId: string) => {
      clearTooltipHide();
      tooltipHideTimeout.current = setTimeout(() => {
        hideTimelineEvent(eventId);
      }, 140);
    },
    [clearTooltipHide, hideTimelineEvent],
  );

  const showTimelineEvent = useCallback(
    (eventId: string, anchorElement: HTMLElement) => {
      clearTooltipHide();
      const rect = anchorElement.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      dispatch({
        type: "showEvent",
        eventId,
        anchor: {
          eventId,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          vertical:
            rect.top > Math.min(360, viewportHeight * 0.46) ? "above" : "below",
          horizontal:
            rect.left < 260
              ? "left"
              : rect.right > viewportWidth - 360
                ? "right"
                : "center",
        },
      });
    },
    [clearTooltipHide],
  );

  useEffect(() => clearTooltipHide, [clearTooltipHide]);

  const setVisibleRange = useCallback(
    (range: DateRange | ((range: DateRange) => DateRange)) => {
      dispatch({ type: "setVisibleRange", range });
    },
    [],
  );
  const setDrag = useCallback(
    (nextDrag: DragState | null) => dispatch({ type: "setDrag", drag: nextDrag }),
    [],
  );

  const updateRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      setVisibleRange(clampRange({ start: nextStart, end: nextEnd }, fullRange));
    },
    [fullRange, setVisibleRange],
  );

  const resetRange = useCallback(
    () => setVisibleRange(defaultVisibleRange),
    [defaultVisibleRange, setVisibleRange],
  );
  const showFullRange = useCallback(
    () => setVisibleRange(fullRange),
    [fullRange, setVisibleRange],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const span = visibleRange.end - visibleRange.start;
      const center = visibleRange.start + span / 2;
      const nextSpan = span * factor;
      updateRange(center - nextSpan / 2, center + nextSpan / 2);
    },
    [updateRange, visibleRange.end, visibleRange.start],
  );

  const setPreset = useCallback(
    (preset: "all" | "mrd" | "recent") => {
      if (preset === "all") {
        showFullRange();
        return;
      }
      if (preset === "mrd") {
        updateRange(toTime("2026-04-01"), toTime("2026-06-30"));
        return;
      }
      updateRange(toTime("2026-05-01"), fullRange.end);
    },
    [fullRange.end, showFullRange, updateRange],
  );

  const toggleSleeve = useCallback(
    (sleeveId: string) => dispatch({ type: "toggleSleeve", sleeveId }),
    [],
  );

  const dragHandlers = usePlotDragHandlers({
    drag,
    fullRange,
    setDrag,
    setVisibleRange,
    updateRange,
    visibleRange,
  });

  return (
    <section
      className="grid gap-4"
      data-test-id="diagnostic-timeline"
      data-visible-range={`${formatIsoDate(visibleRange.start)}:${formatIsoDate(
        visibleRange.end,
      )}`}
    >
      <TimelineControls
        activeX={activeX}
        eventDots={allEventDots}
        filter={filter}
        fullRange={fullRange}
        onFilterChange={(nextFilter) =>
          dispatch({ type: "setFilter", filter: nextFilter })
        }
        onPreset={setPreset}
        onResetRange={resetRange}
        onZoom={zoomBy}
        visibleEventCount={visibleEventCount}
        visibleRange={visibleRange}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <TimelineAxis
          activeX={activeX}
          monthTicks={monthTicks}
          onWheel={dragHandlers.onWheel}
          weekTicks={weekTicks}
          visibleRange={visibleRange}
        />

        <TimelineSleeves
          activeEventId={activeEventId}
          collapsedSleeves={collapsedSleeves}
          drag={drag}
          dragHandlers={dragHandlers}
          monthTicks={monthTicks}
          onActivate={showTimelineEvent}
          onDeactivate={scheduleHideTimelineEvent}
          onToggleSleeve={toggleSleeve}
          sleeves={filteredSleeves}
          visibleRange={visibleRange}
          weekTicks={weekTicks}
        />
      </div>

      {activeEvent && tooltipAnchor?.eventId === activeEvent.event.id ? (
        <TimelineTooltip
          activeEvent={activeEvent}
          anchor={tooltipAnchor}
          onMouseEnter={clearTooltipHide}
          onMouseLeave={() => hideTimelineEvent(activeEvent.event.id)}
        />
      ) : null}
    </section>
  );
}

function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case "hideEvent": {
      const shouldClear =
        action.eventId === undefined || state.activeEventId === action.eventId;
      return {
        ...state,
        activeEventId: shouldClear ? null : state.activeEventId,
        tooltipAnchor:
          action.eventId === undefined || state.tooltipAnchor?.eventId === action.eventId
            ? null
            : state.tooltipAnchor,
      };
    }
    case "setDrag":
      return { ...state, drag: action.drag };
    case "setFilter":
      return { ...state, filter: action.filter };
    case "setTooltipAnchor":
      return { ...state, tooltipAnchor: action.anchor };
    case "setVisibleRange":
      return {
        ...state,
        visibleRange:
          typeof action.range === "function"
            ? action.range(state.visibleRange)
            : action.range,
      };
    case "showEvent":
      return {
        ...state,
        activeEventId: action.eventId,
        tooltipAnchor: action.anchor,
      };
    case "toggleSleeve": {
      const collapsedSleeves = new Set(state.collapsedSleeves);
      if (collapsedSleeves.has(action.sleeveId)) {
        collapsedSleeves.delete(action.sleeveId);
      } else {
        collapsedSleeves.add(action.sleeveId);
      }
      return { ...state, collapsedSleeves };
    }
  }
}

function TimelineControls({
  activeX,
  eventDots,
  filter,
  fullRange,
  onFilterChange,
  onPreset,
  onResetRange,
  onZoom,
  visibleEventCount,
  visibleRange,
}: {
  activeX: number | null;
  eventDots: TimelineEventRef[];
  filter: string;
  fullRange: DateRange;
  onFilterChange: (filter: string) => void;
  onPreset: (preset: "all" | "mrd" | "recent") => void;
  onResetRange: () => void;
  onZoom: (factor: number) => void;
  visibleEventCount: number;
  visibleRange: DateRange;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Filter timeline results"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-3 focus:ring-ring/20"
              placeholder="Filter results..."
              data-test-id="timeline-filter"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onPreset("all")}
              aria-label="Show full timeline"
            >
              All
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onPreset("mrd")}
              aria-label="Focus molecular result window"
            >
              MRD
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onPreset("recent")}
              aria-label="Focus recent results"
            >
              Recent
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => onZoom(0.7)}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => onZoom(1.35)}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={onResetRange}
              aria-label="Reset timeline range"
              title="Reset range"
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </div>

        <Overview
          activeX={activeX}
          events={eventDots}
          fullRange={fullRange}
          visibleRange={visibleRange}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1.5">
            <SlidersHorizontal className="size-3" />
            {visibleEventCount} shown
          </Badge>
          <Badge variant="outline">Reported</Badge>
          <Badge variant="destructive">Flagged</Badge>
          <Badge variant="outline" className="border-dashed">
            Planned
          </Badge>
        </div>
      </div>
    </div>
  );
}

function TimelineSleeves({
  activeEventId,
  collapsedSleeves,
  drag,
  dragHandlers,
  monthTicks,
  onActivate,
  onDeactivate,
  onToggleSleeve,
  sleeves,
  visibleRange,
  weekTicks,
}: {
  activeEventId: string | null;
  collapsedSleeves: Set<string>;
  drag: DragState | null;
  dragHandlers: ReturnType<typeof usePlotDragHandlers>;
  monthTicks: TimelineTick[];
  onActivate: (eventId: string, anchorElement: HTMLElement) => void;
  onDeactivate: (eventId: string) => void;
  onToggleSleeve: (sleeveId: string) => void;
  sleeves: DiagnosticTimelineSleeve[];
  visibleRange: DateRange;
  weekTicks: TimelineTick[];
}) {
  return (
    <div className="divide-y divide-border" data-test-id="timeline-sleeves">
      {sleeves.map((sleeve) => {
        const collapsed = collapsedSleeves.has(sleeve.id);
        const eventCount = sleeve.tracks.reduce(
          (total, track) => total + track.events.length,
          0,
        );

        return (
          <section key={sleeve.id} data-test-id={`timeline-sleeve-${sleeve.id}`}>
            <button
              type="button"
              onClick={() => onToggleSleeve(sleeve.id)}
              className="grid w-full grid-cols-[minmax(148px,220px)_minmax(0,1fr)] items-center bg-muted/50 text-left transition-colors hover:bg-muted/70"
            >
              <span className="flex min-w-0 items-center gap-2 border-r border-border px-3 py-2.5 text-sm font-semibold text-foreground">
                {collapsed ? (
                  <ChevronRight className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
                <span className="truncate">{sleeve.label}</span>
                <span className="text-xs font-medium text-muted-foreground">
                  {eventCount}
                </span>
              </span>
              <span
                className="h-full border-l-4 px-3 py-2.5 text-xs text-muted-foreground"
                style={{ borderColor: sleeve.tone }}
              >
                {sleeve.description}
              </span>
            </button>

            {!collapsed ? (
              <div>
                {sleeve.tracks.map((track) => (
                  <TimelineTrackRow
                    activeEventId={activeEventId}
                    drag={drag}
                    dragHandlers={dragHandlers}
                    key={track.id}
                    monthTicks={monthTicks}
                    onActivate={onActivate}
                    onDeactivate={onDeactivate}
                    sleeve={sleeve}
                    track={track}
                    visibleRange={visibleRange}
                    weekTicks={weekTicks}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TimelineAxis({
  activeX,
  monthTicks,
  onWheel,
  weekTicks,
  visibleRange,
}: {
  activeX: number | null;
  monthTicks: TimelineTick[];
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  weekTicks: TimelineTick[];
  visibleRange: DateRange;
}) {
  return (
    <div className="grid grid-cols-[minmax(148px,220px)_minmax(0,1fr)] border-b border-border bg-background">
      <div className="border-r border-border px-3 py-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
        {formatRange(visibleRange)}
      </div>
      <div className="relative min-w-0 overflow-x-auto">
        <div
          className="relative h-9"
          onWheel={onWheel}
          style={{ minWidth: PLOT_MIN_WIDTH }}
        >
          {weekTicks.map((tick) => {
            const left = percentForTime(tick.time, visibleRange);
            return (
              <div
                aria-hidden="true"
                className="absolute bottom-0 h-3 border-l border-border/55"
                data-test-id="timeline-week-tick"
                key={`week-${tick.time}`}
                style={{ left: `${left}%` }}
                title={`Week of ${tick.label}`}
              />
            );
          })}
          {monthTicks.map((tick) => {
            const left = percentForTime(tick.time, visibleRange);
            return (
              <div
                key={`${tick.label}-${tick.time}`}
                className="absolute top-0 h-full border-l border-border/80"
                data-test-id="timeline-month-tick"
                style={{ left: `${left}%` }}
              >
                <span className="absolute left-1 top-2 whitespace-nowrap text-xs font-medium text-muted-foreground">
                  {tick.label}
                </span>
              </div>
            );
          })}
          {activeX !== null && activeX >= 0 && activeX <= 100 ? (
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-primary/70"
              style={{ left: `${activeX}%` }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineTrackRow({
  activeEventId,
  drag,
  dragHandlers,
  monthTicks,
  onActivate,
  onDeactivate,
  sleeve,
  track,
  visibleRange,
  weekTicks,
}: {
  activeEventId: string | null;
  drag: DragState | null;
  dragHandlers: ReturnType<typeof usePlotDragHandlers>;
  monthTicks: TimelineTick[];
  onActivate: (eventId: string, anchorElement: HTMLElement) => void;
  onDeactivate: (eventId: string) => void;
  sleeve: DiagnosticTimelineSleeve;
  track: DiagnosticTimelineTrack;
  visibleRange: DateRange;
  weekTicks: TimelineTick[];
}) {
  const visibleEvents = track.events.filter((event) =>
    eventIntersectsRange(event, visibleRange),
  );
  const seriesEvents = visibleEvents.filter(
    (event) => typeof event.value === "number",
  );
  const path = buildSeriesPath(seriesEvents, track, visibleRange);
  const activeEvent = track.events.find((event) => event.id === activeEventId);
  const activeX = activeEvent ? percentForDate(activeEvent.date, visibleRange) : null;

  return (
    <div
      className="grid min-h-12 grid-cols-[minmax(148px,220px)_minmax(0,1fr)] border-t border-border/70 first:border-t-0"
      data-test-id={`timeline-track-${track.id}`}
    >
      <div className="flex min-w-0 items-center gap-2 border-r border-border bg-background px-3">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: track.color }}
        />
        <span className="min-w-0 truncate text-sm font-medium text-foreground/80">
          {track.label}
        </span>
        {track.unit ? (
          <span className="shrink-0 text-xs text-muted-foreground">{track.unit}</span>
        ) : null}
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div
          className="relative select-none"
          onPointerDown={dragHandlers.onPointerDown}
          onPointerMove={dragHandlers.onPointerMove}
          onPointerUp={dragHandlers.onPointerUp}
          onPointerCancel={dragHandlers.onPointerCancel}
          onWheel={dragHandlers.onWheel}
          style={{
            minWidth: PLOT_MIN_WIDTH,
            height: TRACK_HEIGHT,
            backgroundImage:
              "linear-gradient(to bottom, rgba(148, 163, 184, 0.10) 1px, transparent 1px)",
            backgroundSize: "100% 24px",
            backgroundColor: "var(--background)",
          }}
          data-plot-panel
        >
          <TimelineGrid
            monthTicks={monthTicks}
            visibleRange={visibleRange}
            weekTicks={weekTicks}
          />

          {path ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              preserveAspectRatio="none"
              viewBox={`0 0 100 ${TRACK_HEIGHT}`}
            >
              <path
                d={path}
                fill="none"
                stroke={track.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={0.7}
                strokeWidth={2.2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}

          {activeX !== null && activeX >= 0 && activeX <= 100 ? (
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-primary/50"
              style={{ left: `${activeX}%` }}
            />
          ) : null}

          {visibleEvents.map((event, index) => (
            <TimelineMarker
              event={event}
              isActive={event.id === activeEventId}
              key={event.id}
              onActivate={onActivate}
              onDeactivate={onDeactivate}
              sleeve={sleeve}
              stackIndex={index}
              track={track}
              visibleRange={visibleRange}
            />
          ))}

          {drag?.mode === "zoom" ? (
            <div
              className="pointer-events-none absolute inset-y-1 rounded border border-primary/50 bg-primary/10"
              style={selectionStyle(drag)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineMarker({
  event,
  isActive,
  onActivate,
  onDeactivate,
  sleeve,
  stackIndex,
  track,
  visibleRange,
}: {
  event: DiagnosticTimelineEvent;
  isActive: boolean;
  onActivate: (eventId: string, anchorElement: HTMLElement) => void;
  onDeactivate: (eventId: string) => void;
  sleeve: DiagnosticTimelineSleeve;
  stackIndex: number;
  track: DiagnosticTimelineTrack;
  visibleRange: DateRange;
}) {
  const x = percentForDate(event.date, visibleRange);
  const top = markerTop(event, track, stackIndex);
  const endX = event.endDate ? percentForDate(event.endDate, visibleRange) : null;
  const planned = event.status === "planned";
  const flagged = event.status === "flagged";
  const label = `${formatDisplayDate(event.date)} ${track.label}: ${
    event.valueLabel ?? event.result
  }`;

  return (
    <>
      {endX !== null ? (
        <span
          aria-hidden="true"
          className="absolute h-1.5 rounded-full"
          style={{
            backgroundColor: track.color,
            left: `${Math.min(x, endX)}%`,
            top,
            width: `${Math.abs(endX - x)}%`,
          }}
        />
      ) : null}
      <button
        type="button"
        aria-describedby={isActive ? `timeline-tooltip-${event.id}` : undefined}
        aria-label={label}
        className={cn(
          "absolute z-10 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
          planned ? "border-dashed bg-background" : "border-background",
          flagged && "ring-2 ring-red-200",
          isActive && "scale-125 ring-3 ring-ring/35",
        )}
        data-test-id={`timeline-marker-${event.id}`}
        onBlur={() => onDeactivate(event.id)}
        onClick={(item) => onActivate(event.id, item.currentTarget)}
        onFocus={(item) => onActivate(event.id, item.currentTarget)}
        onMouseEnter={(item) => onActivate(event.id, item.currentTarget)}
        onMouseLeave={() => onDeactivate(event.id)}
        style={
          {
            "--track-color": track.color,
            backgroundColor: planned ? "var(--background)" : track.color,
            borderColor: planned ? track.color : "var(--background)",
            left: `${x}%`,
            top,
          } as CSSProperties
        }
        title={`${sleeve.label} / ${event.label}`}
      >
        <span className="sr-only">{event.label}</span>
        {planned ? (
          <span
            aria-hidden="true"
            className="absolute inset-1 rounded-full"
            style={{ backgroundColor: track.color }}
          />
        ) : null}
      </button>
    </>
  );
}

function TimelineGrid({
  monthTicks,
  visibleRange,
  weekTicks,
}: {
  monthTicks: TimelineTick[];
  visibleRange: DateRange;
  weekTicks: TimelineTick[];
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {weekTicks.map((tick) => (
        <span
          className="absolute inset-y-0 border-l border-border/25"
          key={`week-grid-${tick.time}`}
          style={{ left: `${percentForTime(tick.time, visibleRange)}%` }}
        />
      ))}
      {monthTicks.map((tick) => (
        <span
          className="absolute inset-y-0 border-l border-border/55"
          key={`month-grid-${tick.time}`}
          style={{ left: `${percentForTime(tick.time, visibleRange)}%` }}
        />
      ))}
    </div>
  );
}

function TimelineTooltip({
  activeEvent,
  anchor,
  onMouseEnter,
  onMouseLeave,
}: {
  activeEvent: TimelineEventRef;
  anchor: TooltipAnchor;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { event, sleeve, track } = activeEvent;

  return (
    <aside
      className="fixed z-50 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-card p-4 shadow-xl"
      data-test-id={`timeline-tooltip-${event.id}`}
      id={`timeline-tooltip-${event.id}`}
      onBlur={(item) => {
        if (!item.currentTarget.contains(item.relatedTarget as Node | null)) {
          onMouseLeave();
        }
      }}
      onFocus={onMouseEnter}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="tooltip"
      style={{
        borderColor: `${track.color}66`,
        left: anchor.x,
        top: anchor.y,
        transform: tooltipTransform(anchor),
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
            {formatDisplayDate(event.date)} · {sleeve.label}
          </div>
          <h2 className="mt-1 break-words text-base font-semibold tracking-normal text-foreground">
            {event.label}
          </h2>
        </div>
        <Badge
          variant={event.status === "flagged" ? "destructive" : "outline"}
          className="shrink-0 capitalize"
        >
          {event.status}
        </Badge>
      </div>

      {event.valueLabel ? (
        <div className="mt-3 break-words font-mono text-xl font-semibold tracking-normal text-foreground">
          {event.valueLabel}
        </div>
      ) : null}

      <p className="mt-3 break-words text-sm leading-6 text-foreground/85">
        {event.result}
      </p>

      {event.details?.length ? (
        <ul className="mt-3 space-y-1.5">
          {event.details.map((detail) => (
            <li
              key={detail}
              className="flex gap-2 text-sm leading-5 text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: track.color }}
              />
              <span className="break-words">{detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {event.links?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {event.links.map((link) => (
            <TimelineLink key={`${link.label}-${link.href}`} link={link} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function tooltipTransform(anchor: TooltipAnchor) {
  const verticalOffset =
    anchor.vertical === "above" ? "calc(-100% - 14px)" : "14px";

  if (anchor.horizontal === "left") {
    return `translate(-16px, ${verticalOffset})`;
  }
  if (anchor.horizontal === "right") {
    return `translate(calc(-100% + 16px), ${verticalOffset})`;
  }

  return `translate(-50%, ${verticalOffset})`;
}

function TimelineLink({ link }: { link: DiagnosticTimelineLink }) {
  const external = /^https?:\/\//.test(link.href);
  const icon = link.label.toLowerCase().includes("report") ? (
    <FileText className="size-3.5" />
  ) : (
    <ExternalLink className="size-3.5" />
  );

  return (
    <a
      href={link.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      {icon}
      <span className="truncate">{link.label}</span>
    </a>
  );
}

function Overview({
  activeX,
  events,
  fullRange,
  visibleRange,
}: {
  activeX: number | null;
  events: TimelineEventRef[];
  fullRange: DateRange;
  visibleRange: DateRange;
}) {
  const left = percentForTime(visibleRange.start, fullRange);
  const right = percentForTime(visibleRange.end, fullRange);

  return (
    <div
      className="relative mt-3 h-12 overflow-hidden rounded-lg border border-border bg-muted/40"
      data-test-id="timeline-overview"
    >
      {events.map(({ event, track }) => {
        const x = percentForDate(event.date, fullRange);
        const top = overviewTop(event.status, track.id);
        return (
          <span
            aria-hidden="true"
            className={cn(
              "absolute size-1.5 -translate-x-1/2 rounded-full opacity-75",
              event.status === "planned" && "opacity-35",
            )}
            key={event.id}
            style={{
              backgroundColor: track.color,
              left: `${x}%`,
              top,
            }}
          />
        );
      })}
      <div
        className="absolute inset-y-0 rounded-md border-x-2 border-primary/60 bg-primary/10"
        style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }}
      />
      {activeX !== null && activeX >= 0 && activeX <= 100 ? (
        <div
          className="absolute inset-y-0 border-l border-primary/70"
          style={{ left: `${activeX}%` }}
        />
      ) : null}
    </div>
  );
}

function usePlotDragHandlers({
  drag,
  fullRange,
  setDrag,
  setVisibleRange,
  updateRange,
  visibleRange,
}: {
  drag: DragState | null;
  fullRange: DateRange;
  setDrag: (drag: DragState | null) => void;
  setVisibleRange: (range: DateRange | ((range: DateRange) => DateRange)) => void;
  updateRange: (nextStart: number, nextEnd: number) => void;
  visibleRange: DateRange;
}) {
  const xFromPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const x = xFromPointer(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag(
        event.shiftKey
          ? {
              mode: "pan",
              startX: x,
              currentX: x,
              initialRange: visibleRange,
            }
          : {
              mode: "zoom",
              startX: x,
              currentX: x,
            },
      );
    },
    [setDrag, visibleRange, xFromPointer],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!drag) return;
      const x = xFromPointer(event);
      if (drag.mode === "zoom") {
        setDrag({ ...drag, currentX: x });
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const span = drag.initialRange.end - drag.initialRange.start;
      const delta = ((x - drag.startX) / rect.width) * span;
      setDrag({ ...drag, currentX: x });
      setVisibleRange(
        clampRange(
          {
            start: drag.initialRange.start - delta,
            end: drag.initialRange.end - delta,
          },
          fullRange,
        ),
      );
    },
    [drag, fullRange, setDrag, setVisibleRange, xFromPointer],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!drag) return;
      const x = xFromPointer(event);
      if (drag.mode === "zoom") {
        const rect = event.currentTarget.getBoundingClientRect();
        const startPx = Math.min(drag.startX, x);
        const endPx = Math.max(drag.startX, x);
        if (endPx - startPx > 12) {
          const startTime = timeForPercent(startPx / rect.width, visibleRange);
          const endTime = timeForPercent(endPx / rect.width, visibleRange);
          updateRange(startTime, endTime);
        }
      }
      setDrag(null);
    },
    [drag, setDrag, updateRange, visibleRange, xFromPointer],
  );

  const onPointerCancel = useCallback(() => setDrag(null), [setDrag]);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const scale =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1;
        const panPixels = event.deltaX * scale;

        setVisibleRange((currentRange) => {
          const span = currentRange.end - currentRange.start;
          const delta = (panPixels / rect.width) * span;

          return clampRange(
            {
              start: currentRange.start + delta,
              end: currentRange.end + delta,
            },
            fullRange,
          );
        });
        return;
      }
      if (!event.metaKey) return;
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const cursorPercent = (event.clientX - rect.left) / rect.width;
      const cursorTime = timeForPercent(cursorPercent, visibleRange);
      const factor = event.deltaY > 0 ? 1.16 : 0.86;
      const nextStart = cursorTime - (cursorTime - visibleRange.start) * factor;
      const nextEnd = cursorTime + (visibleRange.end - cursorTime) * factor;
      updateRange(nextStart, nextEnd);
    },
    [fullRange, setVisibleRange, updateRange, visibleRange],
  );

  return { onPointerCancel, onPointerDown, onPointerMove, onPointerUp, onWheel };
}

function flattenEvents(sleeves: DiagnosticTimelineSleeve[]): TimelineEventRef[] {
  return sleeves.flatMap((sleeve) =>
    sleeve.tracks.flatMap((track) =>
      track.events.map((event) => ({
        event,
        sleeve,
        track,
      })),
    ),
  );
}

function eventMatchesFilter(
  event: DiagnosticTimelineEvent,
  track: DiagnosticTimelineTrack,
  sleeve: DiagnosticTimelineSleeve,
  filter: string,
) {
  const haystack = [
    sleeve.label,
    track.label,
    event.label,
    event.result,
    event.valueLabel,
    ...(event.details ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(filter);
}

function eventIntersectsRange(
  event: DiagnosticTimelineEvent,
  visibleRange: DateRange,
) {
  const start = toTime(event.date);
  const end = event.endDate ? toTime(event.endDate) : start;
  return end >= visibleRange.start && start <= visibleRange.end;
}

function buildSeriesPath(
  events: DiagnosticTimelineEvent[],
  track: DiagnosticTimelineTrack,
  visibleRange: DateRange,
) {
  const points = events
    .filter((event) => typeof event.value === "number")
    .sort((a, b) => toTime(a.date) - toTime(b.date))
    .map((event) => ({
      x: percentForDate(event.date, visibleRange),
      y: valueY(event.value ?? 0, track),
    }));

  if (points.length < 2) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function markerTop(
  event: DiagnosticTimelineEvent,
  track: DiagnosticTimelineTrack,
  stackIndex: number,
) {
  if (typeof event.value === "number") return valueY(event.value, track);
  if (track.kind === "series") return TRACK_HEIGHT / 2;
  const offsets = [-6, 0, 6];
  return TRACK_HEIGHT / 2 + offsets[stackIndex % offsets.length];
}

function valueY(value: number, track: DiagnosticTimelineTrack) {
  const [min, max] = track.valueDomain ?? [0, 1];
  const normalize = (input: number) => {
    if (track.scale === "log") {
      const safeMin = Math.max(min, 0.0001);
      const safeMax = Math.max(max, safeMin + 0.0001);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      return (Math.log10(Math.max(input, safeMin)) - logMin) / (logMax - logMin);
    }
    return (input - min) / (max - min);
  };
  const normalized = Math.min(Math.max(normalize(value), 0), 1);
  return SERIES_BOTTOM - normalized * (SERIES_BOTTOM - SERIES_TOP);
}

function overviewTop(status: string, trackId: string) {
  const hash = [...trackId].reduce((total, char) => total + char.charCodeAt(0), 0);
  const lane = hash % 4;
  const base = status === "planned" ? 32 : 10;
  return base + lane * 6;
}

function selectionStyle(drag: Extract<DragState, { mode: "zoom" }>): CSSProperties {
  const left = Math.min(drag.startX, drag.currentX);
  const width = Math.abs(drag.currentX - drag.startX);
  return { left, width };
}

function buildMonthTicks(start: number, end: number) {
  const ticks: TimelineTick[] = [];
  const startDate = new Date(start);
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();

  while (Date.UTC(year, month, 1) < start) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  for (;;) {
    const time = Date.UTC(year, month, 1);
    if (time > end) break;
    ticks.push({
      label: MONTH_TICK_FORMATTER.format(new Date(time)),
      time,
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return ticks;
}

function buildWeekTicks(start: number, end: number) {
  const ticks: TimelineTick[] = [];
  const startDate = new Date(start);
  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const daysUntilSunday = (7 - startDate.getUTCDay()) % 7;
  let time = startUtc + daysUntilSunday * MS_PER_DAY;

  if (time < start) {
    time += 7 * MS_PER_DAY;
  }

  while (time <= end) {
    ticks.push({
      label: WEEK_TICK_FORMATTER.format(new Date(time)),
      time,
    });
    time += 7 * MS_PER_DAY;
  }

  return ticks;
}

function clampRange(range: DateRange, fullRange: DateRange): DateRange {
  const span = Math.max(range.end - range.start, MIN_RANGE_MS);
  let start = range.start;
  let end = range.start + span;

  if (end > fullRange.end) {
    end = fullRange.end;
    start = end - span;
  }
  if (start < fullRange.start) {
    start = fullRange.start;
    end = start + span;
  }
  if (end > fullRange.end) {
    end = fullRange.end;
  }

  return { start, end };
}

function percentForDate(date: string, range: DateRange) {
  return percentForTime(toTime(date), range);
}

function percentForTime(time: number, range: DateRange) {
  const span = range.end - range.start;
  if (span <= 0) return 0;
  return ((time - range.start) / span) * 100;
}

function timeForPercent(percent: number, range: DateRange) {
  return range.start + (range.end - range.start) * percent;
}

function toTime(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}

function formatDisplayDate(date: string) {
  return DISPLAY_DATE_FORMATTER.format(new Date(toTime(date)));
}

function formatIsoDate(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

function formatRange(range: DateRange) {
  const start = RANGE_START_FORMATTER.format(new Date(range.start));
  const end = RANGE_END_FORMATTER.format(new Date(range.end));
  return `${start} - ${end}`;
}
