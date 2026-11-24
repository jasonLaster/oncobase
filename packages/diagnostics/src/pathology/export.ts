import type { PathologySlide } from "./model";

/** Rectangle in full-resolution (level 0) image pixels. */
export interface ImageRect { x: number; y: number; width: number; height: number }
export interface ExportPlan {
  level: number; downsample: number; width: number; height: number;
  /** Region in the chosen level's pixel space. */
  left: number; top: number;
  tiles: Array<{ col: number; row: number; dx: number; dy: number }>;
}

/** Browsers (iOS Safari especially) refuse canvases much past ~16.7 MP. */
export const EXPORT_MAX_PIXELS = 16_000_000;
export const EXPORT_MAX_SIDE = 8192;

export function clampRect(rect: ImageRect, slide: Pick<PathologySlide, "width" | "height">): ImageRect | null {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(slide.width, Math.ceil(rect.x + rect.width)), bottom = Math.min(slide.height, Math.ceil(rect.y + rect.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * Picks the sharpest Deep Zoom level whose stitched output fits the canvas
 * budget, and lists the tiles covering the rectangle. Tile geometry matches
 * OpenSlide's DeepZoomGenerator: each tile starts `overlap` pixels before its
 * grid cell (except the first) so drawing at `col * tileSize - overlap` lines up.
 */
export function planExport(slide: Pick<PathologySlide, "width" | "height" | "tileSize" | "overlap" | "maxLevel">, rect: ImageRect,
  maxPixels = EXPORT_MAX_PIXELS, maxSide = EXPORT_MAX_SIDE): ExportPlan | null {
  const area = clampRect(rect, slide);
  if (!area) return null;
  for (let level = slide.maxLevel; level >= 0; level--) {
    const downsample = 2 ** (slide.maxLevel - level);
    const levelWidth = Math.ceil(slide.width / downsample), levelHeight = Math.ceil(slide.height / downsample);
    const left = Math.floor(area.x / downsample), top = Math.floor(area.y / downsample);
    const right = Math.min(levelWidth, Math.ceil((area.x + area.width) / downsample));
    const bottom = Math.min(levelHeight, Math.ceil((area.y + area.height) / downsample));
    const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
    if (width * height > maxPixels || Math.max(width, height) > maxSide) continue;
    const ts = slide.tileSize, tiles: ExportPlan["tiles"] = [];
    for (let row = Math.floor(top / ts); row <= Math.floor((top + height - 1) / ts); row++) {
      for (let col = Math.floor(left / ts); col <= Math.floor((left + width - 1) / ts); col++) {
        tiles.push({ col, row, dx: col * ts - (col ? slide.overlap : 0) - left, dy: row * ts - (row ? slide.overlap : 0) - top });
      }
    }
    return { level, downsample, width, height, left, top, tiles };
  }
  return null;
}

export function exportFileName(slide: Pick<PathologySlide, "label" | "stain" | "slideId">, kind: string, plan: Pick<ExportPlan, "width" | "height">) {
  const slug = (value: string) => value.normalize("NFKD").replace(/&/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${[slug(slide.label) || slide.slideId, slug(slide.stain), slug(kind)].filter(Boolean).join("_")}_${plan.width}x${plan.height}.jpg`;
}

async function loadTile(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (response.status === 404) return null; // blank background tiles are not stored
  if (!response.ok) throw new Error(`Tile request failed (${response.status})`);
  return createImageBitmap(await response.blob());
}

/** Stitches the planned tiles into a JPEG. Missing background tiles stay white. */
export async function renderExport(slide: Pick<PathologySlide, "slideId">, plan: ExportPlan,
  { onProgress, signal, quality = 0.92 }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal; quality?: number } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width; canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot build the image");
  context.fillStyle = "#fff"; context.fillRect(0, 0, plan.width, plan.height);
  let next = 0, done = 0;
  onProgress?.(0, plan.tiles.length);
  const worker = async () => {
    while (next < plan.tiles.length) {
      const tile = plan.tiles[next++];
      const bitmap = await loadTile(`/api/pathology/slides/${slide.slideId}/tiles/${plan.level}/${tile.col}_${tile.row}.jpg`, signal);
      if (bitmap) { context.drawImage(bitmap, tile.dx, tile.dy); bitmap.close(); }
      onProgress?.(++done, plan.tiles.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, plan.tiles.length) }, worker));
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("The image was too large for this browser");
  return blob;
}

export function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href, download: fileName });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
