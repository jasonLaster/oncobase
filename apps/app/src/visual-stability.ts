export type VisualStabilityEvent = {
  at: number;
  kind: string;
  region?: string;
  data?: Record<string, unknown>;
};

export type VisualStabilityReport = {
  version: 1;
  frames: number;
  maxFrameGapMs: number;
  cls: number | null;
  shiftsWithInput: number;
  counts: Record<string, number>;
  seen: string[];
  events: VisualStabilityEvent[];
  droppedEvents: number;
  firstIncident: VisualStabilityEvent[] | null;
  capabilities: string[];
};

export type VisualStabilityObserver = {
  report(): VisualStabilityReport;
  reset(): void;
  stop(): void;
  mark(name: string, data?: Record<string, unknown>): void;
};

declare global {
  interface Window {
    __WIKI_VISUAL_STABILITY__?: VisualStabilityObserver;
  }
}

/** Self-contained so Playwright can install this exact observer before app JS.
 * Opt-in, local only: no DOM text, URLs, identifiers, request bodies, or uploads.
 * Geometry uses viewport boxes; visibility changes and input are recorded
 * separately from CLS, whose recent-input exemption can conceal bad flashes.
 */
export function installVisualStabilityObserver() {
  if (window.__WIKI_VISUAL_STABILITY__) return;
  const selectors: Record<string, string> = {
    heading: '[data-test-id="document-article"] .page-header h1',
    body: '[data-test-id="document-article"] .wiki-markdown',
    navigation: '[data-test-id="wiki-sidebar"]',
    rightRail: '[data-wiki-shell-right-rail]',
    mobileHeader: '[data-test-id="mobile-page-header"]',
    commentsLink: '[data-test-id="wiki-sidebar"] a[href="/comments"]',
    diagnosticsLink: '[data-test-id="wiki-sidebar"] a[href^="/diagnostics"]',
  };
  type Box = { x: number; y: number; width: number; height: number };
  type Region = { visible: boolean; box: Box; content: boolean };
  const capabilities = PerformanceObserver.supportedEntryTypes ?? [];
  const fresh = (): VisualStabilityReport => ({
    version: 1, frames: 0, maxFrameGapMs: 0,
    cls: capabilities.includes("layout-shift") ? 0 : null,
    shiftsWithInput: 0, counts: {}, seen: [], events: [], droppedEvents: 0, firstIncident: null,
    capabilities: capabilities.filter((type) => ["paint", "layout-shift", "longtask", "resource"].includes(type)),
  });
  let report = fresh();
  let previous: Record<string, Region> = {};
  let lastFrame = 0;
  let lastRoute = location.pathname;
  let routeNumber = 0;
  let lastInput = -Infinity;
  let lastScroll = -Infinity;
  let phase = "";
  let stopped = false;
  let measurementStart = 0;
  let raf = 0;
  let shiftWindow = { start: 0, last: 0, value: 0 };
  const observers: PerformanceObserver[] = [];
  const round = (value: number) => Math.round(value * 10) / 10;
  const boxOf = (rect: DOMRectReadOnly): Box => ({ x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) });
  const emit = (kind: string, region?: string, data?: Record<string, unknown>, at = performance.now()) => {
    report.counts[kind] = (report.counts[kind] ?? 0) + 1;
    report.events.push({ at: round(at), kind, region, data });
    if (!report.firstIncident && ["disappearance", "content-cleared", "geometry"].includes(kind)) {
      report.firstIncident = structuredClone(report.events.slice(-25));
    }
    if (report.events.length > 250) {
      report.events.shift();
      report.droppedEvents++;
    }
  };
  const visible = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const regionFor = (node: Node | null) => {
    if (!(node instanceof Element)) return "unknown";
    for (const [name, selector] of Object.entries(selectors)) if (node.closest(selector)) return name;
    // Only fixed tag categories, never IDs, classes, text, or asset URLs.
    return ["IMG", "TABLE", "SVG", "BUTTON", "P"].includes(node.tagName) ? node.tagName.toLowerCase() : "other";
  };
  function sample(now: number) {
    if (stopped) return;
    if (document.visibilityState === "hidden") {
      lastFrame = 0;
      raf = requestAnimationFrame(sample);
      return;
    }
    report.frames++;
    if (lastFrame) report.maxFrameGapMs = Math.max(report.maxFrameGapMs, round(now - lastFrame));
    lastFrame = now;
    if (location.pathname !== lastRoute) {
      lastRoute = location.pathname;
      emit("route", undefined, { number: ++routeNumber });
      // Keep continuity across route changes. Tests can explicitly reset for
      // navigation to non-reader surfaces or intentional access revocation.
    }
    const snapshot = document.getElementById("wiki-first-frame-snapshot");
    const loading = [...document.querySelectorAll<HTMLElement>('[data-test-id="page-loading"]')].some(visible);
    const nextPhase = snapshot && visible(snapshot) ? "snapshot" : loading ? "loading" : "live";
    if (phase !== nextPhase) {
      emit("surface", undefined, { from: phase || "boot", to: nextPhase });
      phase = nextPhase;
    }
    for (const [region, selector] of Object.entries(selectors)) {
      const element = [...document.querySelectorAll<HTMLElement>(selector)].find(visible);
      const old = previous[region];
      if (!element) {
        if (old?.visible) {
          emit("disappearance", region, { recentInput: now - lastInput < 500 });
          previous[region] = { ...old, visible: false };
        }
        continue;
      }
      const box = boxOf(element.getBoundingClientRect());
      const content = Boolean(element.textContent?.trim());
      if (!old) {
        report.seen.push(region);
        emit("appearance", region, { box });
      } else if (!old.visible) {
        emit("reappearance", region, { box });
      } else {
        // Body height may grow additively. Its top/width and the title's whole
        // box should stay stable; rails must not resize without an action.
        const keys: Array<keyof Box> = region === "body" ? ["x", "y", "width"] : ["x", "y", "width", "height"];
        const moved = keys.some((key) => Math.abs(box[key] - old.box[key]) > 1);
        if (moved && now - lastScroll > 150) emit("geometry", region, {
          from: old.box, to: box, recentInput: now - lastInput < 500,
        });
        if (old.content && !content) emit("content-cleared", region);
      }
      previous[region] = { visible: true, box, content };
    }
    raf = requestAnimationFrame(sample);
  }
  function observe(type: string, callback: (entry: PerformanceEntry) => void) {
    if (!capabilities.includes(type)) return;
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => {
      if (entry.startTime >= measurementStart) callback(entry);
    }));
    observer.observe({ type, buffered: true });
    observers.push(observer);
  }
  observe("layout-shift", (raw) => {
    const entry = raw as PerformanceEntry & {
      value: number; hadRecentInput: boolean;
      sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>;
    };
    if (entry.hadRecentInput) report.shiftsWithInput++;
    else {
      if (shiftWindow.value === 0 || entry.startTime - shiftWindow.last >= 1000 || entry.startTime - shiftWindow.start >= 5000) {
        shiftWindow = { start: entry.startTime, last: entry.startTime, value: entry.value };
      } else {
        shiftWindow.last = entry.startTime;
        shiftWindow.value += entry.value;
      }
      report.cls = Math.max(report.cls ?? 0, shiftWindow.value);
    }
    emit("layout-shift", undefined, {
      value: entry.value, recentInput: entry.hadRecentInput,
      sources: entry.sources?.map((source) => ({
        region: regionFor(source.node), from: boxOf(source.previousRect), to: boxOf(source.currentRect),
      })),
    }, entry.startTime);
  });
  observe("paint", (entry) => emit("paint", undefined, { name: entry.name }, entry.startTime));
  observe("longtask", (entry) => emit("longtask", undefined, { duration: round(entry.duration) }, entry.startTime));
  observe("resource", (raw) => {
    const entry = raw as PerformanceResourceTiming;
    const pathname = new URL(entry.name, location.origin).pathname;
    const endpoint = ["session", "manifest", "pages"].find((name) => pathname === `/api/wiki/${name}`);
    const category = endpoint ?? (entry.initiatorType === "img" ? "image" : /\.(woff2?|css|js|wasm)$/.exec(pathname)?.[1]);
    if (category) emit("resource", undefined, { category, duration: round(entry.duration) }, entry.startTime + entry.duration);
  });
  const input = () => { lastInput = performance.now(); emit("input"); };
  const scroll = () => { lastScroll = performance.now(); };
  const resize = () => {
    emit("viewport", undefined, { width: innerWidth, height: innerHeight });
    previous = {};
  };
  const fonts = () => emit("fonts-ready");
  const visibility = () => { lastFrame = 0; emit("visibility", undefined, { hidden: document.hidden }); };
  window.addEventListener("pointerdown", input, true);
  window.addEventListener("keydown", input, true);
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", visibility);
  document.fonts?.addEventListener("loadingdone", fonts);
  window.__WIKI_VISUAL_STABILITY__ = {
    report: () => structuredClone(report),
    mark: (name, data) => emit(`phase:${name}`, undefined, data),
    reset: () => {
      report = fresh(); previous = {}; phase = ""; lastFrame = 0;
      measurementStart = performance.now();
      shiftWindow = { start: performance.now(), last: performance.now(), value: 0 };
      for (const observer of observers) observer.takeRecords();
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      for (const observer of observers) observer.disconnect();
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("keydown", input, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      document.fonts?.removeEventListener("loadingdone", fonts);
    },
  };
  raf = requestAnimationFrame(sample);
}
