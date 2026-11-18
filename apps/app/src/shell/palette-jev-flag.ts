import { safeLocalStorage } from "@oncobase/safe-storage";

/** Flag: the file palette asks Jev (typesafe-ai/jev, through the AI Gateway)
 * which pages best match the query and lists them under "Recommended".
 * On by default; VITE_PALETTE_JEV=false turns it off for a build, and this
 * device's choice from the command palette ("Stop recommending pages with
 * Jev") overrides the build. */
const STORAGE_KEY = "oncobase:palette-jev";
const env = import.meta.env as Record<string, string | undefined>;

export function paletteJevEnabled() {
  const stored = safeLocalStorage.getItem(STORAGE_KEY);
  if (stored === "on") return true;
  if (stored === "off") return false;
  return env.VITE_PALETTE_JEV !== "false";
}

export function setPaletteJevEnabled(enabled: boolean) {
  safeLocalStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
}
