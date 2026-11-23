import type { TalkPage } from "./page-conversation";

/** App pages (not wiki markdown) that a call can be about. Each supplies its
 * own text, built from the data the page itself renders. */
const CELLULARITY: TalkPage = { slug: "app/diagnostics/cellularity", title: "Tumor-bed cellularity explorer" };

export function appTalkPage(pathname: string): TalkPage | null {
  return pathname === "/diagnostics/cellularity" ? CELLULARITY : null;
}

/** Page text for an app page, or undefined when the slug is a wiki page. */
export async function loadAppTalkText(slug: string): Promise<string | null | undefined> {
  if (slug !== CELLULARITY.slug) return undefined;
  try {
    const [{ CELLULARITY_DATA_URL }, { cellularityTalkText }] = await Promise.all([
      import("../pages/cellularity/utils"),
      import("../pages/cellularity/talk-text"),
    ]);
    const response = await fetch(CELLULARITY_DATA_URL, { credentials: "same-origin" });
    if (!response.ok) return null;
    return cellularityTalkText(await response.json());
  } catch {
    return null;
  }
}
