import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type OpenSeadragon from "openseadragon";
import { formatLength, regionLengthMicrons, type PathologyRegion, type PathologySlide, type SlideCamera } from "./model";

export interface SlideControls {
  home(): void; zoom(factor: number): void; magnify(power: number): void; rotate(): void;
  focus(region: PathologyRegion): void; camera(): SlideCamera | null;
}
export type SlideTool = "pan" | "region" | "ruler";
let runtime: Promise<typeof OpenSeadragon> | undefined;
const loadRuntime = () => runtime ??= import("openseadragon").then(module => module.default);

export function SlideCanvas({ slide, tool = "pan", regions = [], selectedRegion, controlsRef, initialCamera,
  onRegion, onCamera, onRendered, title }: {
  slide: PathologySlide; tool?: SlideTool; regions?: PathologyRegion[]; selectedRegion?: string;
  controlsRef: RefObject<SlideControls | null>; initialCamera?: SlideCamera | null;
  onRegion?: (region: PathologyRegion) => void; onCamera?: (camera: SlideCamera) => void;
  onRendered?: () => void; title: string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const viewer = useRef<OpenSeadragon.Viewer | null>(null);
  const osd = useRef<typeof OpenSeadragon | null>(null);
  const callback = useRef({ onRegion, onCamera, onRendered });
  useEffect(() => { callback.current = { onRegion, onCamera, onRendered }; }, [onRegion, onCamera, onRendered]);
  const navigatorId = useId().replaceAll(":", "");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<PathologyRegion | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const restore = useRef(initialCamera);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let lastCamera = 0;
    let failed = false;
    setStatus("loading");
    void loadRuntime().then(OSD => {
      if (cancelled || !mount.current) return;
      osd.current = OSD;
      const tileSource = new OSD.TileSource({ width: slide.width, height: slide.height,
        tileSize: slide.tileSize, tileOverlap: slide.overlap, minLevel: 0, maxLevel: slide.maxLevel });
      tileSource.getTileUrl = (level, x, y) => `/api/pathology/slides/${slide.slideId}/tiles/${level}/${x}_${y}.jpg`;
      // Runtime accepts TileSource instances; the published options type omits them.
      const instance = OSD({ element: mount.current, tileSources: tileSource as unknown as OpenSeadragon.TileSourceOptions,
        showNavigationControl: false, showNavigator: true, navigatorId,
        navigatorAutoFade: false, navigatorBackground: "#fff", navigatorDisplayRegionColor: "#2563eb",
        navigatorBorderColor: "#64748b", animationTime: 0.25, blendTime: 0.1,
        visibilityRatio: 0.75, constrainDuringPan: true, maxZoomPixelRatio: 2,
        imageLoaderLimit: 6, timeout: 20_000, maxImageCacheCount: 100,
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
        gestureSettingsTouch: { pinchToZoom: true, flickEnabled: false },
      });
      viewer.current = instance;
      const camera = (): SlideCamera | null => {
        const item = instance.world.getItemAt(0);
        if (!item) return null;
        const center = item.viewportToImageCoordinates(instance.viewport.getCenter(true));
        return { x: center.x, y: center.y, zoom: item.viewportToImageZoom(instance.viewport.getZoom(true)), rotation: instance.viewport.getRotation() };
      };
      controlsRef.current = {
        home() { instance.viewport.setRotation(0); instance.viewport.goHome(); },
        zoom(factor) { instance.viewport.zoomBy(factor); instance.viewport.applyConstraints(); },
        magnify(power) {
          const item = instance.world.getItemAt(0);
          if (item && slide.objectivePower) instance.viewport.zoomTo(item.imageToViewportZoom(power / slide.objectivePower));
        },
        rotate() { instance.viewport.setRotation((instance.viewport.getRotation() + 90) % 360); },
        focus(region) {
          const item = instance.world.getItemAt(0);
          if (!item) return;
          const pad = Math.max(100, Math.abs(region.endX - region.x), Math.abs(region.endY - region.y)) * 0.25;
          instance.viewport.fitBounds(item.imageToViewportRectangle(Math.min(region.x, region.endX) - pad, Math.min(region.y, region.endY) - pad,
            Math.abs(region.endX - region.x) + pad * 2, Math.abs(region.endY - region.y) + pad * 2));
        },
        camera,
      };
      instance.addHandler("open", () => {
        const saved = restore.current;
        const item = instance.world.getItemAt(0);
        if (saved && item && saved.x <= slide.width && saved.y <= slide.height) {
          instance.viewport.setRotation(saved.rotation);
          instance.viewport.panTo(item.imageToViewportCoordinates(saved.x, saved.y), true);
          instance.viewport.zoomTo(item.imageToViewportZoom(saved.zoom), undefined, true);
          instance.viewport.applyConstraints(true);
        }
      });
      instance.addHandler("tiled-image-drawn", event => {
        if (failed || !(event as unknown as { tiles?: unknown[] }).tiles?.length) return;
        setStatus("ready");
        callback.current.onRendered?.();
      });
      const fail = () => { failed = true; setStatus("error"); };
      instance.addHandler("tile-load-failed", fail);
      instance.addHandler("open-failed", fail);
      instance.addHandler("viewport-change", () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; setRevision(value => value + 1); });
        if (Date.now() - lastCamera > 200) {
          lastCamera = Date.now();
          const current = camera();
          if (current) callback.current.onCamera?.(current);
        }
      });
      instance.addHandler("animation-finish", () => {
        const current = camera();
        if (current) callback.current.onCamera?.(current);
        setRevision(value => value + 1);
      });
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      viewer.current?.destroy(); viewer.current = null; controlsRef.current = null;
    };
  }, [slide.slideId, slide.width, slide.height, slide.tileSize, slide.overlap, slide.maxLevel, slide.objectivePower, navigatorId, controlsRef]);

  const instance = viewer.current;
  const item = instance?.world.getItemAt(0);
  const OSD = osd.current;
  const screen = (x: number, y: number) => {
    if (!instance || !item) return { x: 0, y: 0 };
    return instance.viewport.pixelFromPoint(item.imageToViewportCoordinates(x, y), true);
  };
  const imagePoint = (clientX: number, clientY: number) => {
    if (!instance || !item || !OSD || !mount.current) return null;
    const rect = mount.current.getBoundingClientRect();
    const point = item.viewportToImageCoordinates(instance.viewport.pointFromPixel(new OSD.Point(clientX - rect.left, clientY - rect.top), true));
    return { x: Math.max(0, Math.min(slide.width, point.x)), y: Math.max(0, Math.min(slide.height, point.y)) };
  };
  let micronsPerScreenPixel = 0;
  if (instance && item && OSD && slide.mppX && slide.mppY) {
    const a = item.viewportToImageCoordinates(instance.viewport.pointFromPixel(new OSD.Point(0, 0), true));
    const b = item.viewportToImageCoordinates(instance.viewport.pointFromPixel(new OSD.Point(100, 0), true));
    micronsPerScreenPixel = Math.hypot((b.x - a.x) * slide.mppX, (b.y - a.y) * slide.mppY) / 100;
  }
  const target = micronsPerScreenPixel * 100;
  const decade = 10 ** Math.floor(Math.log10(target || 1));
  const scale = [1, 2, 5].map(n => n * decade).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  const imageZoom = instance && item ? item.viewportToImageZoom(instance.viewport.getZoom(true)) : 0;
  const power = slide.objectivePower ? imageZoom * slide.objectivePower : null;

  return <div className="pathology-canvas" data-test-id="pathology-canvas" data-slide-id={slide.slideId} data-render-status={status} data-revision={revision}
    role="application" tabIndex={0} aria-label={`${title}: drag to pan, scroll to zoom`} onKeyDown={event => {
      const controls = controlsRef.current;
      if (!controls || !instance || !OSD) return;
      const actions: Record<string, () => void> = { "+": () => controls.zoom(1.5), "=": () => controls.zoom(1.5), "-": () => controls.zoom(1 / 1.5),
        "0": () => controls.home(), "r": () => controls.rotate(),
        "ArrowLeft": () => instance.viewport.panBy(new OSD.Point(-0.08 / instance.viewport.getZoom(), 0)),
        "ArrowRight": () => instance.viewport.panBy(new OSD.Point(0.08 / instance.viewport.getZoom(), 0)),
        "ArrowUp": () => instance.viewport.panBy(new OSD.Point(0, -0.08 / instance.viewport.getZoom())),
        "ArrowDown": () => instance.viewport.panBy(new OSD.Point(0, 0.08 / instance.viewport.getZoom())) };
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); instance.viewport.applyConstraints(); }
      if (event.key === "Escape") { start.current = null; setDraft(null); }
    }}>
    <div ref={mount} className="pathology-osd" />
    <svg className={`pathology-overlay ${tool === "pan" ? "" : "is-drawing"}`} aria-hidden="true"
      onPointerDown={event => {
        if (tool === "pan" || event.button !== 0 || status !== "ready") return;
        const point = imagePoint(event.clientX, event.clientY);
        if (!point) return;
        start.current = point;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraft({ id: crypto.randomUUID(), kind: tool, x: point.x, y: point.y, endX: point.x, endY: point.y, label: tool === "ruler" ? "Measurement" : `Region ${regions.length + 1}`, note: "", color: "#eab308" });
      }} onPointerMove={event => {
        if (!start.current) return;
        const point = imagePoint(event.clientX, event.clientY);
        if (point) setDraft(value => value ? { ...value, endX: point.x, endY: point.y } : null);
      }} onPointerUp={event => {
        if (!start.current || !draft) return;
        const point = imagePoint(event.clientX, event.clientY);
        const region = point ? { ...draft, endX: point.x, endY: point.y } : draft;
        start.current = null; setDraft(null);
        if (Math.hypot(region.endX - region.x, region.endY - region.y) > 5) callback.current.onRegion?.(region);
      }} onPointerCancel={() => { start.current = null; setDraft(null); }}>
      {[...regions, ...(draft ? [draft] : [])].map((region, index) => {
        const a = screen(region.x, region.y), b = screen(region.endX, region.endY);
        const corners = [a, screen(region.endX, region.y), b, screen(region.x, region.endY)];
        const length = regionLengthMicrons(region, slide);
        return <g key={region.id} stroke={region.color} strokeWidth={region.id === selectedRegion ? 3 : 2}>
          {region.kind === "region" ? <polygon points={corners.map(p => `${p.x},${p.y}`).join(" ")} fill={region.color} fillOpacity={0.08} />
            : <><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><circle cx={a.x} cy={a.y} r={4} fill={region.color} /><circle cx={b.x} cy={b.y} r={4} fill={region.color} /></>}
          <text x={a.x + 5} y={a.y - 8} fill={region.color} stroke="#111827" strokeWidth={3} paintOrder="stroke" fontSize={13}>
            {region.kind === "ruler" && length !== null ? formatLength(length) : `${index + 1}. ${region.label}`}
          </text>
        </g>;
      })}
    </svg>
    <div className="pathology-view-label"><span>{title}</span><strong data-test-id="pathology-magnification">{power ? `${power.toFixed(1)}×${power > (slide.objectivePower ?? 0) * 1.01 ? " · digital" : ""}` : "Overview"}</strong></div>
    <div id={navigatorId} className="pathology-navigator" aria-label="Tissue overview navigator" />
    {micronsPerScreenPixel > 0 && <div className="pathology-scalebar" data-test-id="pathology-scalebar"><span>{formatLength(scale)}</span><i style={{ width: scale / micronsPerScreenPixel }} /></div>}
    {status === "loading" && <div className="pathology-canvas-status" role="status">Loading slide…</div>}
    {status === "error" && <div className="pathology-canvas-status pathology-canvas-error" role="alert">Some slide tiles could not load.<button onClick={() => window.location.reload()}>Retry</button></div>}
  </div>;
}
