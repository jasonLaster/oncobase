"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
const DRILLDOWN_WIDTH = 1120;
const DRILLDOWN_HEIGHT = 420;
const DRILLDOWN_AXIS_SLOT_WIDTH = 54;
const DRILLDOWN_PLOT = { bottom: 336, left: 198, right: 1084, top: 42 };
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
  | { type: "setVisibleRange"; range: DateRange | ((range: DateRange) => DateRange) }
  | { type: "showEvent"; anchor: TooltipAnchor; eventId: string }
  | { type: "toggleSleeve"; sleeveId: string };

type DrilldownTarget =
  | {
      scope: "sleeve";
      sleeve: DiagnosticTimelineSleeve;
    }
  | {
      scope: "track";
      sleeve: DiagnosticTimelineSleeve;
      track: DiagnosticTimelineTrack;
    };

interface DrilldownTooltipState {
  color: string;
  date: string;
  details: string[];
  id: string;
  label: string;
  links: DiagnosticTimelineLink[];
  placement: "above" | "below";
  result: string;
  trackLabel: string;
  valueLabel: string | null;
  x: number;
  y: number;
}

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
  const [drilldownTarget, setDrilldownTarget] = useState<DrilldownTarget | null>(
    null,
  );
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
  const activeOverviewX = activeEvent
    ? percentForDate(activeEvent.event.date, fullRange)
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

  const zoomBy = useCallback(
    (factor: number) => {
      const span = visibleRange.end - visibleRange.start;
      const center = visibleRange.start + span / 2;
      const nextSpan = span * factor;
      updateRange(center - nextSpan / 2, center + nextSpan / 2);
    },
    [updateRange, visibleRange.end, visibleRange.start],
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
      <div className="rounded-lg border border-border bg-background shadow-sm">
        <TimelineStickyHeader
          activeOverviewX={activeOverviewX}
          activeX={activeX}
          eventDots={allEventDots}
          filter={filter}
          fullRange={fullRange}
          monthTicks={monthTicks}
          onFilterChange={(nextFilter) =>
            dispatch({ type: "setFilter", filter: nextFilter })
          }
          onRangeChange={setVisibleRange}
          onResetRange={resetRange}
          onWheel={dragHandlers.onWheel}
          onZoom={zoomBy}
          visibleRange={visibleRange}
          weekTicks={weekTicks}
        />

        <TimelineSleeves
          activeEventId={activeEventId}
          collapsedSleeves={collapsedSleeves}
          drag={drag}
          dragHandlers={dragHandlers}
          monthTicks={monthTicks}
          onActivate={showTimelineEvent}
          onDeactivate={scheduleHideTimelineEvent}
          onInspectSleeve={(sleeve) =>
            setDrilldownTarget({ scope: "sleeve", sleeve })
          }
          onInspectTrack={(sleeve, track) =>
            setDrilldownTarget({ scope: "track", sleeve, track })
          }
          onToggleSleeve={toggleSleeve}
          sleeves={filteredSleeves}
          visibleRange={visibleRange}
          weekTicks={weekTicks}
        />
      </div>

      <TimelineDrilldownDialog
        fullRange={fullRange}
        onOpenChange={(open) => {
          if (!open) setDrilldownTarget(null);
        }}
        target={drilldownTarget}
      />

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

function TimelineStickyHeader({
  activeOverviewX,
  activeX,
  eventDots,
  filter,
  fullRange,
  monthTicks,
  onFilterChange,
  onRangeChange,
  onResetRange,
  onWheel,
  onZoom,
  visibleRange,
  weekTicks,
}: {
  activeOverviewX: number | null;
  activeX: number | null;
  eventDots: TimelineEventRef[];
  filter: string;
  fullRange: DateRange;
  monthTicks: TimelineTick[];
  onFilterChange: (filter: string) => void;
  onRangeChange: (range: DateRange | ((range: DateRange) => DateRange)) => void;
  onResetRange: () => void;
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  onZoom: (factor: number) => void;
  visibleRange: DateRange;
  weekTicks: TimelineTick[];
}) {
  return (
    <div
      className="sticky top-0 z-40 rounded-t-lg border-b border-border bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/88"
      data-test-id="timeline-sticky-header"
    >
      <div
        className="flex flex-wrap items-center gap-3 border-b border-border/80 px-3 py-2"
        data-test-id="timeline-toolbar"
      >
        <div className="min-w-48 flex-1">
          <div className="text-sm font-semibold tracking-normal text-foreground">
            Date window
          </div>
          <div
            className="text-xs font-medium tracking-normal text-muted-foreground"
            data-test-id="timeline-visible-range-label"
          >
            {formatRange(visibleRange)}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-56 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Filter timeline results"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-3 focus:ring-ring/20"
              placeholder="Filter timeline..."
              data-test-id="timeline-filter"
            />
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
      </div>

      <div className="grid grid-cols-[minmax(148px,220px)_minmax(0,1fr)] border-b border-border/80">
        <div className="border-r border-border px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
            Overview
          </div>
          <div className="text-xs font-medium tracking-normal text-muted-foreground">
            Window
          </div>
        </div>
        <div className="min-w-0 border-l border-border/60 px-3 py-2">
          <Overview
            activeX={activeOverviewX}
            events={eventDots}
            fullRange={fullRange}
            onRangeChange={onRangeChange}
            visibleRange={visibleRange}
          />
        </div>
      </div>

      <TimelineAxis
        activeX={activeX}
        monthTicks={monthTicks}
        onWheel={onWheel}
        weekTicks={weekTicks}
        visibleRange={visibleRange}
      />
    </div>
  );
}

function TimelineDrilldownDialog({
  fullRange,
  onOpenChange,
  target,
}: {
  fullRange: DateRange;
  onOpenChange: (open: boolean) => void;
  target: DrilldownTarget | null;
}) {
  const tracks =
    target?.scope === "track"
      ? [target.track]
      : target?.scope === "sleeve"
        ? target.sleeve.tracks
        : [];
  const title =
    target?.scope === "track"
      ? target.track.label
      : target?.scope === "sleeve"
        ? target.sleeve.label
        : "Timeline detail";
  const description =
    target?.scope === "track"
      ? "Expanded swimlane view with a larger y-axis and all recorded points."
      : "Expanded category view with numeric swimlanes overlaid and color-coded y-axis domains.";
  const targetKey =
    target?.scope === "track"
      ? `track:${target.track.id}`
      : target?.scope === "sleeve"
        ? `sleeve:${target.sleeve.id}`
        : "none";
  const trackIds = tracks.map((track) => track.id).join(":");
  const allTrackIds = useMemo(
    () => (trackIds ? trackIds.split(":") : []),
    [trackIds],
  );
  const [trackToggleState, setTrackToggleState] = useState<{
    enabledTrackIds: Set<string>;
    targetKey: string;
  }>(() => ({
    enabledTrackIds: new Set(allTrackIds),
    targetKey,
  }));
  const enabledTrackIds =
    trackToggleState.targetKey === targetKey
      ? trackToggleState.enabledTrackIds
      : new Set(allTrackIds);

  const visibleTracks = tracks.filter((track) => enabledTrackIds.has(track.id));
  const toggleTrack = useCallback(
    (trackId: string) => {
      setTrackToggleState((current) => {
        const currentIds =
          current.targetKey === targetKey
            ? current.enabledTrackIds
            : new Set(allTrackIds);
        const next = new Set(currentIds);
        if (next.has(trackId)) {
          if (next.size <= 1) return { enabledTrackIds: next, targetKey };
          next.delete(trackId);
        } else {
          next.add(trackId);
        }
        return { enabledTrackIds: next, targetKey };
      });
    },
    [allTrackIds, targetKey],
  );

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88vh] w-[calc(100vw-2rem)] overflow-y-auto p-0 sm:max-w-[1180px]"
        data-test-id="timeline-drilldown-dialog"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {target ? (
          <div className="grid gap-4 px-5 pb-5">
            <div className="flex flex-wrap gap-2 pt-4">
              {tracks.map((track) => {
                const events = reportedEventsForTrack(track);
                const numericEvents = numericEventsForTrack(track);
                const domain = domainForTrack(track);
                const enabled = enabledTrackIds.has(track.id);
                return (
                  <button
                    aria-pressed={enabled}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                      enabled
                        ? "bg-background text-foreground"
                        : "bg-muted/40 text-muted-foreground opacity-60 hover:opacity-85",
                    )}
                    data-test-id={`timeline-drilldown-track-toggle-${track.id}`}
                    key={track.id}
                    onClick={() => toggleTrack(track.id)}
                    type="button"
                    style={{ borderColor: `${track.color}66` }}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: track.color }}
                    />
                    {track.label}
                    {numericEvents.length > 0 ? (
                      <span className="text-muted-foreground">
                        {formatChartValue(domain[0])} - {formatChartValue(domain[1])}
                        {track.unit ? ` ${track.unit}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {events.length} events
                      </span>
                    )}
                    {track.scale === "log" ? (
                      <span className="font-mono text-[10px] uppercase tracking-normal text-muted-foreground">
                        log
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <DrilldownChart fullRange={fullRange} tracks={visibleTracks} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DrilldownChart({
  fullRange,
  tracks,
}: {
  fullRange: DateRange;
  tracks: DiagnosticTimelineTrack[];
}) {
  const plot = DRILLDOWN_PLOT;
  const [tooltip, setTooltip] = useState<DrilldownTooltipState | null>(null);
  const [activeAxisTrackId, setActiveAxisTrackId] = useState<string | null>(null);
  const drilldownTracks: Array<{
    domain: [number, number];
    events: Array<DiagnosticTimelineEvent & { value: number }>;
    eventMarkers: DiagnosticTimelineEvent[];
    track: DiagnosticTimelineTrack;
  }> = [];

  tracks.forEach((track) => {
    const events = numericEventsForTrack(track);
    const markerEvents = reportedEventsForTrack(track).filter(
      (event) => typeof event.value !== "number",
    );
    if (events.length > 0) {
      drilldownTracks.push({
        domain: domainForTrack(track),
        events,
        eventMarkers: markerEvents,
        track,
      });
      return;
    }

    if (markerEvents.length > 0) {
      drilldownTracks.push({
        domain: [0, 1],
        events: [],
        eventMarkers: markerEvents,
        track,
      });
    }
  });
  const monthTicks = buildMonthTicks(fullRange.start, fullRange.end);
  const weekTicks = buildWeekTicks(fullRange.start, fullRange.end);
  const chartTracks = drilldownTracks.map((track, index) => ({
    ...track,
    axis: drilldownAxisPlacement(index, drilldownTracks.length, plot),
  }));
  const showsNormalizedOverlay = chartTracks.length > 1;

  const showTooltip = useCallback(
    (element: SVGGraphicsElement, track: DiagnosticTimelineTrack, event: DiagnosticTimelineEvent) => {
      const targetBox = element.getBoundingClientRect();

      setActiveAxisTrackId(track.id);
      setTooltip({
        color: track.color,
        date: formatDisplayDate(event.date),
        details: event.details ?? [],
        id: `${track.id}-${event.id}`,
        label: event.label,
        links: event.links ?? [],
        placement: "above",
        result: event.result,
        trackLabel: track.label,
        valueLabel: event.valueLabel ?? null,
        x: targetBox.left + targetBox.width / 2,
        y: targetBox.top + targetBox.height / 2,
      });
    },
    [],
  );
  const activateAxis = useCallback((trackId: string | null) => {
    setActiveAxisTrackId(trackId);
  }, []);
  const hideTooltip = useCallback(() => {
    setActiveAxisTrackId(null);
    setTooltip(null);
  }, []);

  return (
    <div className="grid gap-2 overflow-hidden rounded-lg border border-border bg-background p-3">
      {showsNormalizedOverlay ? (
        <div
          className="text-xs font-medium text-muted-foreground"
          data-test-id="timeline-drilldown-note"
        >
          Normalized per swimlane. Color labels above show each y-axis domain.
        </div>
      ) : null}
      <div
        className="relative overflow-x-auto overscroll-x-contain rounded-md bg-muted/20"
        data-test-id="timeline-drilldown-chart"
        onPointerLeave={hideTooltip}
      >
        <div
          className="relative min-w-[1120px]"
          style={{ height: DRILLDOWN_HEIGHT }}
        >
          <div
            className="pointer-events-none sticky left-0 top-0 z-20 bg-background/95 shadow-[8px_0_18px_rgba(15,23,42,0.08)]"
            style={{ height: DRILLDOWN_HEIGHT, width: plot.left }}
          >
            <svg
              className="pointer-events-auto block"
              data-test-id="timeline-drilldown-axis-svg"
              height={DRILLDOWN_HEIGHT}
              role="presentation"
              style={{
                fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
              }}
              viewBox={`0 0 ${plot.left} ${DRILLDOWN_HEIGHT}`}
              width={plot.left}
            >
              <rect
                x="0"
                y="0"
                width={plot.left}
                height={DRILLDOWN_HEIGHT}
                fill="var(--background)"
                fillOpacity="0.94"
              />
              {chartTracks.map(({ axis, domain, events, track }) => (
                <DrilldownYAxis
                  activeTrackId={activeAxisTrackId}
                  axis={axis}
                  domain={domain}
                  key={`axis-${track.id}`}
                  onAxisActivate={activateAxis}
                  plot={plot}
                  scale={track.scale}
                  showTicks={events.length > 0}
                  track={track}
                />
              ))}
            </svg>
          </div>
        <svg
          className="absolute left-0 top-0 block h-full w-full"
          data-test-id="timeline-drilldown-svg"
          height={DRILLDOWN_HEIGHT}
          role="img"
          aria-label="Expanded timeline chart"
          style={{
            aspectRatio: `${DRILLDOWN_WIDTH} / ${DRILLDOWN_HEIGHT}`,
            fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
          }}
          viewBox={`0 0 ${DRILLDOWN_WIDTH} ${DRILLDOWN_HEIGHT}`}
          width={DRILLDOWN_WIDTH}
        >
          <rect
            x="0"
            y="0"
            width={DRILLDOWN_WIDTH}
            height={DRILLDOWN_HEIGHT}
            fill="var(--background)"
          />
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = plot.bottom - tick * (plot.bottom - plot.top);
            return (
              <line
                key={`grid-y-${tick}`}
                x1={plot.left}
                x2={plot.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.12"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {weekTicks.map((tick) => {
            const x = chartX(tick.time, fullRange, plot);
            return (
              <line
                key={`drill-week-${tick.time}`}
                x1={x}
                x2={x}
                y1={plot.top}
                y2={plot.bottom}
                stroke="currentColor"
                strokeOpacity="0.08"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {monthTicks.map((tick) => {
            const x = chartX(tick.time, fullRange, plot);
            return (
              <g key={`drill-month-${tick.time}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={plot.top}
                  y2={plot.bottom}
                  stroke="currentColor"
                  strokeOpacity="0.2"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={x + 8}
                  y={plot.bottom + 34}
                  fill="currentColor"
                  fontSize="14"
                  fontWeight="600"
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
          <line
            data-test-id="timeline-drilldown-plot-left-edge"
            x1={plot.left}
            x2={plot.left}
            y1={plot.top}
            y2={plot.bottom}
            stroke="currentColor"
            strokeOpacity="0.35"
            vectorEffect="non-scaling-stroke"
          />
          <line
            data-test-id="timeline-drilldown-plot-right-edge"
            x1={plot.right}
            x2={plot.right}
            y1={plot.top}
            y2={plot.bottom}
            stroke="currentColor"
            strokeOpacity="0.22"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={plot.left}
            x2={plot.right}
            y1={plot.bottom}
            y2={plot.bottom}
            stroke="currentColor"
            strokeOpacity="0.35"
            vectorEffect="non-scaling-stroke"
          />
          {chartTracks.map(({ domain, events, track }) => {
            const path = drilldownPath(events, domain, track, fullRange, plot);
            return (
              <g key={`series-${track.id}`}>
                {path ? (
                  <path
                    data-test-id={`timeline-drilldown-series-${track.id}`}
                    d={path}
                    fill="none"
                    stroke={track.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                    onPointerEnter={() => activateAxis(track.id)}
                    onPointerLeave={() => activateAxis(null)}
                  />
                ) : null}
                {events.map((event) => (
                  <circle
                    aria-label={`${track.label}: ${
                      event.valueLabel ?? event.result
                    } on ${formatDisplayDate(event.date)}`}
                    data-test-id={`timeline-drilldown-point-${track.id}-${event.id}`}
                    key={`point-${track.id}-${event.id}`}
                    cx={chartX(toTime(event.date), fullRange, plot)}
                    cy={chartY(event.value ?? 0, domain, track.scale, plot)}
                    r="5"
                    fill={track.color}
                    onBlur={hideTooltip}
                    onFocus={(focusEvent) =>
                      showTooltip(focusEvent.currentTarget, track, event)
                    }
                    onPointerEnter={(pointerEvent) =>
                      showTooltip(pointerEvent.currentTarget, track, event)
                    }
                    onPointerLeave={hideTooltip}
                    onPointerMove={(pointerEvent) =>
                      showTooltip(pointerEvent.currentTarget, track, event)
                    }
                    stroke="var(--background)"
                    strokeWidth="2"
                    tabIndex={0}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>
                      {track.label}: {event.valueLabel ?? event.result} on{" "}
                      {formatDisplayDate(event.date)}
                    </title>
                  </circle>
                ))}
              </g>
            );
          })}
          {chartTracks.flatMap(({ eventMarkers, track }) =>
            eventMarkers.map((event) => (
              <circle
                aria-label={`${track.label}: ${event.label} on ${formatDisplayDate(
                  event.date,
                )}`}
                data-test-id={`timeline-drilldown-event-${track.id}-${event.id}`}
                key={`event-${track.id}-${event.id}`}
                cx={chartX(toTime(event.date), fullRange, plot)}
                cy={chartY(0.5, [0, 1], "linear", plot)}
                r="5"
                fill={track.color}
                onBlur={hideTooltip}
                onFocus={(focusEvent) =>
                  showTooltip(focusEvent.currentTarget, track, event)
                }
                onPointerEnter={(pointerEvent) =>
                  showTooltip(pointerEvent.currentTarget, track, event)
                }
                onPointerLeave={hideTooltip}
                onPointerMove={(pointerEvent) =>
                  showTooltip(pointerEvent.currentTarget, track, event)
                }
                opacity="0.85"
                stroke="var(--background)"
                strokeWidth="2"
                tabIndex={0}
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {track.label}: {event.label} on {formatDisplayDate(event.date)}
                </title>
              </circle>
            )),
          )}
        </svg>
        </div>
        {tooltip ? (
          <DrilldownTooltip onPointerLeave={hideTooltip} tooltip={tooltip} />
        ) : null}
      </div>
    </div>
  );
}

interface DrilldownAxisPlacement {
  lineX: number;
  textAnchor: "end" | "start";
  titleX: number;
  tickX1: number;
  tickX2: number;
  valueX: number;
}

function DrilldownYAxis({
  activeTrackId,
  axis,
  domain,
  onAxisActivate,
  plot,
  scale,
  showTicks,
  track,
}: {
  activeTrackId: string | null;
  axis: DrilldownAxisPlacement;
  domain: [number, number];
  onAxisActivate: (trackId: string | null) => void;
  plot: ChartPlot;
  scale: DiagnosticTimelineTrack["scale"];
  showTicks: boolean;
  track: DiagnosticTimelineTrack;
}) {
  const ticks = showTicks ? yAxisTicks(domain, scale) : [];
  const isActive = activeTrackId === track.id;
  const isDimmed = activeTrackId !== null && !isActive;

  return (
    <g
      data-active-axis={isActive ? "true" : "false"}
      data-dimmed-axis={isDimmed ? "true" : "false"}
      data-test-id={`timeline-drilldown-axis-${track.id}`}
      onPointerEnter={() => onAxisActivate(track.id)}
      onPointerLeave={() => onAxisActivate(null)}
      opacity={isDimmed ? 0.24 : 1}
      style={{ transition: "opacity 140ms ease" }}
    >
      <line
        x1={axis.lineX}
        x2={axis.lineX}
        y1={plot.top}
        y2={plot.bottom}
        stroke={track.color}
        strokeOpacity="0.42"
        vectorEffect="non-scaling-stroke"
      />
      <text
        data-test-id={`timeline-drilldown-axis-label-${track.id}`}
        fill={track.color}
        fontSize="12"
        fontWeight="700"
        textAnchor="middle"
        transform={`rotate(-90 ${axis.titleX} ${(plot.top + plot.bottom) / 2})`}
        x={axis.titleX}
        y={(plot.top + plot.bottom) / 2}
      >
        {formatAxisTitle(track)}
      </text>
      {ticks.map((value) => {
        const y = chartY(value, domain, scale, plot);
        return (
          <g key={`axis-${track.id}-${value}`}>
            <line
              x1={axis.tickX1}
              x2={axis.tickX2}
              y1={y}
              y2={y}
              stroke={track.color}
              strokeOpacity="0.7"
              vectorEffect="non-scaling-stroke"
            />
            <text
              fill={track.color}
              fontSize="12"
              fontWeight="600"
              textAnchor={axis.textAnchor}
              x={axis.valueX}
              y={y + 4}
            >
              {formatChartValue(value)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DrilldownTooltip({
  onPointerLeave,
  tooltip,
}: {
  onPointerLeave: () => void;
  tooltip: DrilldownTooltipState;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "pointer-events-auto fixed z-[100] max-w-[320px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg",
        tooltip.placement === "above"
          ? "-translate-x-1/2 -translate-y-[calc(100%+12px)]"
          : "-translate-x-1/2 translate-y-3",
      )}
      data-test-id="timeline-drilldown-tooltip"
      onPointerLeave={onPointerLeave}
      role="tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ backgroundColor: tooltip.color }}
        />
        <span className="font-semibold">{tooltip.trackLabel}</span>
        <span className="text-muted-foreground">{tooltip.date}</span>
      </div>
      <div className="mt-1 font-medium">{tooltip.label}</div>
      {tooltip.valueLabel ? (
        <div className="mt-1 text-muted-foreground">{tooltip.valueLabel}</div>
      ) : null}
      <div className="mt-1 leading-snug">{tooltip.result}</div>
      {tooltip.details.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-muted-foreground">
          {tooltip.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {tooltip.links.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tooltip.links.map((link) => (
            <a
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
              href={link.href}
              key={`${tooltip.id}-${link.href}`}
            >
              {link.label}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
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
  onInspectSleeve,
  onInspectTrack,
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
  onInspectSleeve: (sleeve: DiagnosticTimelineSleeve) => void;
  onInspectTrack: (
    sleeve: DiagnosticTimelineSleeve,
    track: DiagnosticTimelineTrack,
  ) => void;
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
            <div className="grid w-full grid-cols-[minmax(148px,220px)_minmax(0,1fr)] items-center bg-muted/50">
              <button
                type="button"
                onClick={() => onToggleSleeve(sleeve.id)}
                className="flex min-w-0 items-center gap-2 border-r border-border px-3 py-2.5 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/70"
              >
                {collapsed ? (
                  <ChevronRight className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
                <span className="truncate">{sleeve.label}</span>
                <span className="text-xs font-medium text-muted-foreground">
                  {eventCount}
                </span>
              </button>
              <div
                className="flex h-full min-w-0 items-center justify-between gap-2 border-l-4 px-3 py-2.5 text-xs text-muted-foreground"
                style={{ borderColor: sleeve.tone }}
              >
                <span className="min-w-0 truncate">{sleeve.description}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onInspectSleeve(sleeve)}
                  aria-label={`Inspect ${sleeve.label}`}
                  title={`Inspect ${sleeve.label}`}
                  data-test-id={`timeline-inspect-sleeve-${sleeve.id}`}
                >
                  <Search className="size-4" />
                </Button>
              </div>
            </div>

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
                    onInspect={() => onInspectTrack(sleeve, track)}
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
    <div
      className="grid grid-cols-[minmax(148px,220px)_minmax(0,1fr)] bg-background"
      data-test-id="timeline-calendar-axis"
    >
      <div className="border-r border-border px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
          Calendar
        </div>
        <div className="mt-0.5 text-xs font-semibold text-foreground">Weeks</div>
      </div>
      <div className="relative min-w-0 overflow-x-auto overscroll-x-contain">
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
  onInspect,
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
  onInspect: () => void;
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onInspect}
          aria-label={`Inspect ${track.label}`}
          title={`Inspect ${track.label}`}
          data-test-id={`timeline-inspect-track-${track.id}`}
          className="ml-auto"
        >
          <Search className="size-4" />
        </Button>
      </div>

      <div className="min-w-0 overflow-x-auto overscroll-x-contain">
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
  onRangeChange,
  visibleRange,
}: {
  activeX: number | null;
  events: TimelineEventRef[];
  fullRange: DateRange;
  onRangeChange: (range: DateRange | ((range: DateRange) => DateRange)) => void;
  visibleRange: DateRange;
}) {
  const overviewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    initialRange: DateRange;
    mode: "move" | "resize-left" | "resize-right";
    startX: number;
    width: number;
  } | null>(null);
  const left = percentForTime(visibleRange.start, fullRange);
  const right = percentForTime(visibleRange.end, fullRange);

  const dragWindow = useCallback(
    (clientX: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const fullSpan = fullRange.end - fullRange.start;
      const delta = ((clientX - drag.startX) / drag.width) * fullSpan;
      if (drag.mode === "resize-left") {
        onRangeChange(resizeRangeLeft(drag.initialRange, fullRange, delta));
        return;
      }
      if (drag.mode === "resize-right") {
        onRangeChange(resizeRangeRight(drag.initialRange, fullRange, delta));
        return;
      }
      onRangeChange(panRangeByTime(drag.initialRange, fullRange, delta));
    },
    [fullRange, onRangeChange],
  );

  const startWindowDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize-left" | "resize-right") => {
      if (event.button !== 0) return;
      const rect = overviewRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        initialRange: visibleRange,
        mode,
        startX: event.clientX,
        width: rect.width,
      };
    },
    [visibleRange],
  );

  const onWindowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => startWindowDrag(event, "move"),
    [startWindowDrag],
  );

  const onLeftHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) =>
      startWindowDrag(event, "resize-left"),
    [startWindowDrag],
  );

  const onRightHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) =>
      startWindowDrag(event, "resize-right"),
    [startWindowDrag],
  );

  const onWindowPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!dragRef.current) return;
      event.preventDefault();
      dragWindow(event.clientX);
    },
    [dragWindow],
  );

  const stopWindowDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }, []);

  const onWindowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const span = visibleRange.end - visibleRange.start;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const step = span * (event.shiftKey ? 0.25 : 0.1) * direction;
      onRangeChange(panRangeByTime(visibleRange, fullRange, step));
    },
    [fullRange, onRangeChange, visibleRange],
  );

  const onHandleKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLElement>,
      mode: "resize-left" | "resize-right",
    ) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const span = visibleRange.end - visibleRange.start;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const step = span * (event.shiftKey ? 0.25 : 0.1) * direction;
      onRangeChange(
        mode === "resize-left"
          ? resizeRangeLeft(visibleRange, fullRange, step)
          : resizeRangeRight(visibleRange, fullRange, step),
      );
    },
    [fullRange, onRangeChange, visibleRange],
  );

  return (
    <div
      ref={overviewRef}
      className="relative h-14 overflow-hidden overscroll-x-contain rounded-lg border border-border bg-muted/40"
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
      <button
        type="button"
        aria-label={`Drag visible timeline window, ${formatRange(visibleRange)}`}
        className="absolute inset-y-1 cursor-grab rounded-md border border-primary/50 bg-primary/15 transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 active:cursor-grabbing"
        data-test-id="timeline-overview-window"
        onKeyDown={onWindowKeyDown}
        onPointerCancel={stopWindowDrag}
        onPointerDown={onWindowPointerDown}
        onPointerMove={onWindowPointerMove}
        onPointerUp={stopWindowDrag}
        style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }}
      />
      <button
        type="button"
        aria-label={`Resize timeline window start, ${formatRange(visibleRange)}`}
        className="absolute inset-y-1 z-10 w-4 cursor-ew-resize rounded-l-md border border-primary/70 bg-primary/35 transition-colors hover:bg-primary/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        data-test-id="timeline-overview-window-left-handle"
        onKeyDown={(event) => onHandleKeyDown(event, "resize-left")}
        onPointerCancel={stopWindowDrag}
        onPointerDown={onLeftHandlePointerDown}
        onPointerMove={onWindowPointerMove}
        onPointerUp={stopWindowDrag}
        style={{ left: `${left}%` }}
      />
      <button
        type="button"
        aria-label={`Resize timeline window end, ${formatRange(visibleRange)}`}
        className="absolute inset-y-1 z-10 w-4 cursor-ew-resize rounded-r-md border border-primary/70 bg-primary/35 transition-colors hover:bg-primary/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        data-test-id="timeline-overview-window-right-handle"
        onKeyDown={(event) => onHandleKeyDown(event, "resize-right")}
        onPointerCancel={stopWindowDrag}
        onPointerDown={onRightHandlePointerDown}
        onPointerMove={onWindowPointerMove}
        onPointerUp={stopWindowDrag}
        style={{ left: `calc(${right}% - 1rem)` }}
      />
      {activeX !== null && activeX >= 0 && activeX <= 100 ? (
        <div
          className="pointer-events-none absolute inset-y-0 border-l border-primary/70"
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

          return panRangeByTime(currentRange, fullRange, delta);
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

function numericEventsForTrack(track: DiagnosticTimelineTrack) {
  return reportedEventsForTrack(track)
    .filter((event): event is DiagnosticTimelineEvent & { value: number } =>
      typeof event.value === "number",
    )
    .sort((a, b) => toTime(a.date) - toTime(b.date));
}

function reportedEventsForTrack(track: DiagnosticTimelineTrack) {
  return track.events.filter((event) => event.status !== "planned");
}

function domainForTrack(track: DiagnosticTimelineTrack): [number, number] {
  if (track.valueDomain) {
    return track.scale === "log" ? logDomain(track.valueDomain) : track.valueDomain;
  }
  const values = numericEventsForTrack(track).map((event) => event.value);
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (track.scale === "log") {
    return logDomain([min, max]);
  }

  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    return [min - padding, max + padding];
  }

  const padding = (max - min) * 0.08;
  return [Math.max(0, min - padding), max + padding];
}

function logDomain([min, max]: [number, number]): [number, number] {
  const safeMin = Math.max(min, 0.0001);
  const safeMax = Math.max(max, safeMin * 10);
  return [
    10 ** Math.floor(Math.log10(safeMin)),
    10 ** Math.ceil(Math.log10(safeMax)),
  ];
}

function drilldownPath(
  events: Array<DiagnosticTimelineEvent & { value: number }>,
  domain: [number, number],
  track: DiagnosticTimelineTrack,
  fullRange: DateRange,
  plot: ChartPlot,
) {
  if (events.length < 2) return "";
  return events
    .map((event, index) => {
      const x = chartX(toTime(event.date), fullRange, plot);
      const y = chartY(event.value, domain, track.scale, plot);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

interface ChartPlot {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function chartX(time: number, range: DateRange, plot: ChartPlot) {
  const width = plot.right - plot.left;
  return plot.left + (percentForTime(time, range) / 100) * width;
}

function chartY(
  value: number,
  domain: [number, number],
  scale: DiagnosticTimelineTrack["scale"],
  plot: ChartPlot,
) {
  const normalized = normalizedValue(value, domain, scale);
  return plot.bottom - normalized * (plot.bottom - plot.top);
}

function drilldownAxisPlacement(
  index: number,
  total: number,
  plot: ChartPlot,
): DrilldownAxisPlacement {
  const offset = (total - index - 1) * DRILLDOWN_AXIS_SLOT_WIDTH;
  const lineX = plot.left - offset;
  return {
    lineX,
    textAnchor: "end",
    titleX: lineX - 40,
    tickX1: lineX - 8,
    tickX2: lineX,
    valueX: lineX - 12,
  };
}

function formatAxisTitle(track: DiagnosticTimelineTrack) {
  const parts = [track.label];
  const qualifiers = [
    track.unit,
    track.scale === "log" ? "log" : null,
  ].filter(Boolean);
  if (qualifiers.length > 0) {
    parts.push(`(${qualifiers.join(", ")})`);
  }
  return parts.join(" ");
}

function normalizedValue(
  value: number,
  domain: [number, number],
  scale: DiagnosticTimelineTrack["scale"],
) {
  const [min, max] = domain;
  if (scale === "log") {
    const safeMin = Math.max(min, 0.0001);
    const safeMax = Math.max(max, safeMin + 0.0001);
    const logMin = Math.log10(safeMin);
    const logMax = Math.log10(safeMax);
    return Math.min(
      Math.max((Math.log10(Math.max(value, safeMin)) - logMin) / (logMax - logMin), 0),
      1,
    );
  }

  if (max <= min) return 0.5;
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

function yAxisTicks(
  domain: [number, number],
  scale: DiagnosticTimelineTrack["scale"],
) {
  const [min, max] = domain;
  if (scale === "log") {
    const startPower = Math.ceil(Math.log10(Math.max(min, 0.0001)));
    const endPower = Math.floor(Math.log10(Math.max(max, min)));
    const ticks: number[] = [];
    for (let power = startPower; power <= endPower; power += 1) {
      ticks.push(10 ** power);
    }
    return ticks.length > 0 ? ticks : [min, max];
  }
  return [min, min + (max - min) / 2, max];
}

function formatChartValue(value: number) {
  if (value === 0) return "0";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/\.0+$/, "");
  return value.toPrecision(2);
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

function panRangeByTime(range: DateRange, fullRange: DateRange, delta: number) {
  return clampRange(
    {
      start: range.start + delta,
      end: range.end + delta,
    },
    fullRange,
  );
}

function resizeRangeLeft(range: DateRange, fullRange: DateRange, delta: number) {
  return {
    start: Math.min(
      Math.max(range.start + delta, fullRange.start),
      range.end - MIN_RANGE_MS,
    ),
    end: range.end,
  };
}

function resizeRangeRight(range: DateRange, fullRange: DateRange, delta: number) {
  return {
    start: range.start,
    end: Math.max(
      Math.min(range.end + delta, fullRange.end),
      range.start + MIN_RANGE_MS,
    ),
  };
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
