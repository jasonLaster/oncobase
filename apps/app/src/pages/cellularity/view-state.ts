import { useEffect, useSyncExternalStore } from "react";
import type { CellularityData } from "./types";
import { calcRCB, rcbClass } from "./utils";

/** What the reader has selected on the cellularity explorer. Each interactive
 * component publishes its own slice here, and "Talk with the page" reads it so
 * the voice knows which block, view, slider position and layers are on screen. */
export type CellularityViewState = {
  view?: "webgl" | "3d" | "topdown" | "grid";
  selectedBlock?: string;
  focusFields?: number;
  serialTab?: string;
  sensitivityThreshold?: number;
  methodTab?: string;
  rcbCellularity?: number;
  model?: { view: string; question: string; hidden: string[]; laidOut: boolean; cut: boolean; separated: number };
};

let state: CellularityViewState = {};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getCellularityViewState = () => state;
export const subscribeCellularityViewState = subscribe;
export function publishCellularityViewState(change: Partial<CellularityViewState>) {
  const next = { ...state, ...change };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  listeners.forEach((listener) => listener());
}
export const resetCellularityViewState = () => { state = {}; listeners.forEach((listener) => listener()); };
export const useCellularityViewState = () => useSyncExternalStore(subscribe, getCellularityViewState, getCellularityViewState);

/** Publishes a slice of the view for as long as the component is mounted. */
export function usePublishViewState<K extends keyof CellularityViewState>(key: K, value: CellularityViewState[K]) {
  const encoded = JSON.stringify(value);
  useEffect(() => {
    publishCellularityViewState({ [key]: value } as Partial<CellularityViewState>);
    return () => publishCellularityViewState({ [key]: undefined } as Partial<CellularityViewState>);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- encoded stands for value
  }, [key, encoded]);
}

const VIEW_LABEL = { webgl: "3D tumor model", "3d": "breadloaf slices", topdown: "2D top-down map", grid: "grid of all bed blocks" } as const;

/** The reader's current selections in words, for the voice. Empty when nothing is set. */
export function describeViewState(view: CellularityViewState, data: CellularityData): string {
  const lines: string[] = [];
  if (view.view) lines.push(`Bed view: ${VIEW_LABEL[view.view]}.`);
  if (view.selectedBlock) {
    const slice = data.slices.find((s) => s.id === view.selectedBlock);
    const stats = slice?.stats ?? data.summary.rows.find((r) => r.block === view.selectedBlock);
    lines.push(
      `Selected block: ${slice?.label ?? view.selectedBlock}` +
        (stats ? ` (whole-area cellularity ${stats.whole_area.toFixed(2)}%, hottest field ${stats.max1.toFixed(0)}%, ${stats.n_ge5} fields at or above 5%)` : "") +
        (slice && !slice.scanned ? ", not scanned" : slice?.kind === "virtual" ? ", virtual slice" : "") + ".",
    );
  }
  const m = view.model;
  if (m && view.view === "webgl") {
    lines.push(
      `3D model: "${m.view}" view (${m.question})` +
        (m.laidOut ? ", slabs laid out face-up" : "") +
        (m.cut ? ", slabs lateral to the selected slide cut away" : "") +
        (m.separated > 0 ? `, slabs pulled ${Math.round(m.separated * 100)}% apart` : "") +
        (m.hidden.length ? `; hidden layers: ${m.hidden.join(", ")}` : "; all layers shown") + ".",
    );
  }
  if (view.focusFields != null) {
    const cfg = data.report.focus_explorer;
    const b6 = data.b6_cum;
    const i = Math.max(0, Math.min(b6.total - 1, view.focusFields - 1));
    const verdict = cfg.verdicts.find((v) => view.focusFields! <= v.max_k)?.text ?? cfg.verdicts.at(-1)?.text ?? "";
    lines.push(`Focus explorer: counting the hottest ${view.focusFields} of ${b6.total} fields in ${cfg.block_id} gives about ${b6.area[i]?.toFixed(1)}% cancer by area. Page verdict: ${verdict}`);
  }
  if (view.serialTab) lines.push(`Serial-section drawer tab: ${view.serialTab}.`);
  if (view.sensitivityThreshold != null) lines.push(`Validation sensitivity threshold: ${view.sensitivityThreshold}.`);
  if (view.methodTab) lines.push(`Method drawer tab: ${view.methodTab}.`);
  if (view.rcbCellularity != null) {
    const rcb = calcRCB(view.rcbCellularity, data.report.reconcile.rcb);
    lines.push(`RCB calculator: overall cellularity set to ${view.rcbCellularity.toFixed(2)}% gives RCB index ${rcb.total.toFixed(2)}, ${rcbClass(rcb.total).label}.`);
  }
  return lines.join("\n");
}
