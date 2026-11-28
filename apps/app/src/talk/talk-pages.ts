import type { CellularityData } from "../pages/cellularity/types";
import type { TalkPage } from "./page-conversation";

/** App pages (not wiki markdown) that a call can be about. Each supplies its
 * own text, built from the data the page itself renders. */
const CELLULARITY: TalkPage = { slug: "app/diagnostics/cellularity", title: "Tumor-bed cellularity explorer" };
const SINGLE_CELL: TalkPage = { slug: "app/tools/single-cell", title: "Single-cell viewer" };

export function appTalkPage(pathname: string): TalkPage | null {
  if (pathname === "/diagnostics/cellularity") return CELLULARITY;
  if (pathname === "/tools/single-cell") return SINGLE_CELL;
  return null;
}

let cellularityData: CellularityData | null = null;
let singleCellLoaded = false;

/** What the reader currently has selected on an app page, in words. Null when
 * the page has no live state or its data hasn't loaded. */
export async function appTalkStateNote(slug: string): Promise<string | null> {
  if (slug === SINGLE_CELL.slug) {
    if (!singleCellLoaded) return null;
    const { describeSingleCellView, getSingleCellViewState } = await import("../pages/single-cell/view-state");
    return describeSingleCellView(getSingleCellViewState()) || null;
  }
  if (slug !== CELLULARITY.slug || !cellularityData) return null;
  const { describeViewState, getCellularityViewState } = await import("../pages/cellularity/view-state");
  return describeViewState(getCellularityViewState(), cellularityData) || null;
}

async function loadSingleCellTalkText(): Promise<string | null> {
  try {
    const [{ SINGLE_CELL_MANIFEST_PATH, validateManifest }, { assetHref }, { singleCellTalkText }, { describeSingleCellView, getSingleCellViewState }] = await Promise.all([
      import("../pages/single-cell/data"),
      import("../wiki-assets"),
      import("../pages/single-cell/talk-text"),
      import("../pages/single-cell/view-state"),
    ]);
    // `/api/file` serves the manifest only to readers allowed to open it.
    const response = await fetch(assetHref(SINGLE_CELL_MANIFEST_PATH), { credentials: "same-origin" });
    if (!response.ok) return null;
    const manifest = validateManifest(await response.json());
    singleCellLoaded = true;
    const selected = describeSingleCellView(getSingleCellViewState());
    return singleCellTalkText(manifest) + (selected ? `\n\n## What the reader has selected right now\n\n${selected}` : "");
  } catch {
    return null;
  }
}

/** Page text for an app page, or undefined when the slug is a wiki page. */
export async function loadAppTalkText(slug: string): Promise<string | null | undefined> {
  if (slug === SINGLE_CELL.slug) return loadSingleCellTalkText();
  if (slug !== CELLULARITY.slug) return undefined;
  try {
    const [{ CELLULARITY_DATA_URL }, { cellularityTalkText }] = await Promise.all([
      import("../pages/cellularity/utils"),
      import("../pages/cellularity/talk-text"),
    ]);
    const response = await fetch(CELLULARITY_DATA_URL, { credentials: "same-origin" });
    if (!response.ok) return null;
    cellularityData = (await response.json()) as CellularityData;
    const { describeViewState, getCellularityViewState } = await import("../pages/cellularity/view-state");
    const selected = describeViewState(getCellularityViewState(), cellularityData);
    return cellularityTalkText(cellularityData) + (selected ? `\n\n## What the reader has selected right now\n\n${selected}` : "");
  } catch {
    return null;
  }
}
