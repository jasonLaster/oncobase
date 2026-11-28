import { useEffect, useSyncExternalStore } from "react";
import type { GroupStat } from "./data";

/** What the reader has on screen in the single-cell viewer, for "Talk with
 * the page": the library, the coloring, the selected gene and its table. */
export type SingleCellViewState = {
  library?: string;
  colorBy?: string;
  gene?: string;
  geneName?: string;
  layer?: "corrected" | "raw";
  groupBy?: string;
  rows?: Pick<GroupStat, "label" | "nuclei" | "pctExpressing" | "mean">[];
  highlight?: string | null;
};

let state: SingleCellViewState = {};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getSingleCellViewState = () => state;
export function publishSingleCellViewState(change: Partial<SingleCellViewState>) {
  const next = { ...state, ...change };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  listeners.forEach((listener) => listener());
}
export const resetSingleCellViewState = () => { state = {}; listeners.forEach((listener) => listener()); };
export const useSingleCellViewState = () => useSyncExternalStore(subscribe, getSingleCellViewState, getSingleCellViewState);

export function usePublishSingleCellView(view: SingleCellViewState) {
  const encoded = JSON.stringify(view);
  useEffect(() => {
    publishSingleCellViewState(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- encoded stands for view
  }, [encoded]);
  useEffect(() => resetSingleCellViewState, []);
}

const pct = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}%`;

/** The reader's current selection in words. Empty when nothing is set. */
export function describeSingleCellView(view: SingleCellViewState): string {
  const lines: string[] = [];
  if (view.library) lines.push(`Library shown: ${view.library}.`);
  if (view.gene) {
    lines.push(`Selected gene: ${view.gene}${view.geneName && view.geneName !== view.gene ? ` (${view.geneName})` : ""}, ${view.layer === "raw" ? "raw counts" : "background-corrected counts"}. The map is colored by its expression.`);
    if (view.rows?.length) {
      lines.push(`By ${view.groupBy ?? "group"}: ` + view.rows.slice(0, 14).map((row) =>
        `${row.label} ${pct(row.pctExpressing)} of ${row.nuclei.toLocaleString("en-US")} nuclei expressing, mean ${row.mean.toFixed(2)}`).join("; ") + ".");
    }
  } else if (view.colorBy) {
    lines.push(`The map is colored by ${view.colorBy}.`);
  }
  if (view.highlight) lines.push(`Highlighted group: ${view.highlight}.`);
  return lines.join("\n");
}
