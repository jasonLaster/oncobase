export interface PathologySlide {
  slideId: string; label: string; stain: string; accession?: string;
  sourceFileName: string; sourceUri: string; sourceBytes: number; sourceSha256: string;
  width: number; height: number; tileSize: number; overlap: number; maxLevel: number; tileCount: number;
  mppX?: number; mppY?: number; objectivePower?: number; scanner: string; scanDate?: string; colorProfile: string;
}
export interface PathologyRegion {
  id: string; kind: "region" | "ruler"; x: number; y: number; endX: number; endY: number;
  label: string; note: string; color: string;
}
export interface SlideCamera { x: number; y: number; zoom: number; rotation: number }

export function regionLengthMicrons(region: PathologyRegion, slide: PathologySlide) {
  if (!slide.mppX || !slide.mppY) return null;
  return Math.hypot((region.endX - region.x) * slide.mppX, (region.endY - region.y) * slide.mppY);
}
export function formatLength(microns: number) {
  return microns >= 1000 ? `${(microns / 1000).toFixed(2)} mm` : `${Math.round(microns)} µm`;
}
export function readCamera(params: URLSearchParams): SlideCamera | null {
  const values = ["x", "y", "zoom", "rotation"].map(key => params.get(key));
  if (values.some(value => value === null)) return null;
  const [x, y, zoom, rotation] = values.map(Number);
  return [x, y, zoom, rotation].every(Number.isFinite) && zoom > 0 && zoom <= 8 && x >= 0 && y >= 0
    ? { x, y, zoom, rotation: ((rotation % 360) + 360) % 360 } : null;
}
