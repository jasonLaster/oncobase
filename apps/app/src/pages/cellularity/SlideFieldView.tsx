import { type KeyboardEvent, useState } from "react";
import type { BlockGrid, FieldRef, SlideImages } from "./types";
import { cellularityAssetUrl } from "./utils";

/** Context window around the pinned field, in fields (3 → a 3 × 3 mm view). */
const CONTEXT_FIELDS = 3;

type Props = {
  block: string;
  grid: BlockGrid;
  images: SlideImages | undefined;
  field: FieldRef;
  onMove: (f: FieldRef) => void;
  onClose: () => void;
};

/**
 * The real scan behind one 1 mm field: a 3 mm context crop from the block's slide atlas with the field outlined,
 * plus a full-resolution crop when one was published (the richer fields). Orientation matches the grid:
 * anterior up, superior left.
 */
export function SlideFieldView({ block, grid, images, field, onMove, onClose }: Props) {
  const pct = grid.fields.find((f) => f[0] === field.col && f[1] === field.row)?.[2];
  const hasHires = images?.hires.some(([c, r]) => c === field.col && r === field.row) ?? false;
  const fieldKey = `${block}:${field.col}:${field.row}`;
  // Remember which crop failed to load, so moving to another field retries without an effect.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const hiresFailed = failedKey === fieldKey;

  const step = (dc: number, dr: number) => {
    const col = field.col + dc;
    const row = field.row + dr;
    if (grid.fields.some((f) => f[0] === col && f[1] === row)) onMove({ block, col, row });
  };
  /** Arrow keys step one field and Esc closes, from any of the view's buttons. */
  const onKeys = (e: KeyboardEvent<HTMLButtonElement>) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (e.key === "Escape") onClose();
    else if (d[e.key]) {
      e.preventDefault();
      step(...d[e.key]);
    }
  };

  if (!images) {
    return (
      <div className="cel-slide-view" role="region" aria-label="Slide image">
        <div className="cel-slide-view-head">
          <strong>Field ({field.col + 1}, {field.row + 1})</strong>
          <button type="button" className="cel-slide-close" onClick={onClose} aria-label="Close slide image">×</button>
        </div>
        <p className="cel-footnote">Slide images for {block} are not published yet.</p>
      </div>
    );
  }

  const p = images.px_per_field;
  const half = (CONTEXT_FIELDS - 1) / 2;
  // Window origin in atlas px, clamped to the atlas; the field box moves when clamped at an edge.
  const winPx = CONTEXT_FIELDS * p;
  const ox = Math.max(0, Math.min(images.atlas_w - winPx, (field.col - half) * p));
  const oy = Math.max(0, Math.min(images.atlas_h - winPx, (field.row - half) * p));
  const pctOf = (v: number) => `${(100 * v) / winPx}%`;
  const bgSize = `${(100 * images.atlas_w) / winPx}% ${(100 * images.atlas_h) / winPx}%`;
  const bgPos = `${(100 * ox) / Math.max(1, images.atlas_w - winPx)}% ${(100 * oy) / Math.max(1, images.atlas_h - winPx)}%`;

  return (
    <div
      className="cel-slide-view"
      role="region"
      aria-label={`Slide image for ${block} field ${field.col + 1}, ${field.row + 1}`}
    >
      <div className="cel-slide-view-head">
        <span>
          <strong>
            {block} · field ({field.col + 1}, {field.row + 1})
          </strong>{" "}
          <span className="cel-num">{pct != null ? `${pct.toFixed(2)}% keratin area` : ""}</span>
        </span>
        <span className="cel-slide-nav">
          <button type="button" onClick={() => step(-1, 0)} aria-label="Field toward superior" onKeyDown={onKeys}>←</button>
          <button type="button" onClick={() => step(0, -1)} aria-label="Field toward anterior" onKeyDown={onKeys}>↑</button>
          <button type="button" onClick={() => step(0, 1)} aria-label="Field toward posterior" onKeyDown={onKeys}>↓</button>
          <button type="button" onClick={() => step(1, 0)} aria-label="Field toward inferior" onKeyDown={onKeys}>→</button>
          <button type="button" className="cel-slide-close" onClick={onClose} onKeyDown={onKeys} aria-label="Close slide image">×</button>
        </span>
      </div>
      <div className="cel-slide-panes">
        <figure>
          <div
            className="cel-slide-ctx"
            role="img"
            aria-label={`${images.stain} scan, 3 by 3 mm around the field`}
            style={{ backgroundImage: `url("${cellularityAssetUrl(images.atlas)}")`, backgroundSize: bgSize, backgroundPosition: bgPos }}
          >
            <i
              className="cel-slide-box"
              style={{ left: pctOf(field.col * p - ox), top: pctOf(field.row * p - oy), width: pctOf(p), height: pctOf(p) }}
            />
          </div>
          <figcaption>3 × 3 mm around the field · {images.stain} · {images.um_per_px_atlas.toFixed(1)} µm/px</figcaption>
        </figure>
        <figure>
          {hasHires && !hiresFailed ? (
            <img
              className="cel-slide-hires"
              src={cellularityAssetUrl(`slides/${block}_f${field.col}_${field.row}.jpg`)}
              alt={`${images.stain} at full scan resolution, the 1 mm field itself`}
              loading="lazy"
              onError={() => setFailedKey(fieldKey)}
            />
          ) : (
            <div className="cel-slide-hires cel-slide-hires-empty">
              Full-resolution crops are published for the richest fields (≥1% keratin). Use the arrows to step to one.
            </div>
          )}
          <figcaption>The 1 mm field at full scan resolution ({images.hires_um_per_px.toFixed(1)} µm/px)</figcaption>
        </figure>
      </div>
      <p className="cel-footnote">Oriented like the grid: anterior up, superior left. With a button focused, arrow keys move one field and Esc closes.</p>
    </div>
  );
}
