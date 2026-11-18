import { safeLocalStorage } from "@oncobase/safe-storage";

/** Flag: the file palette asks Jev (typesafe-ai/jev, through the AI Gateway)
 * which pages best match the query and lists them under "Recommended".
 * VITE_PALETTE_JEV=true turns it on for a build; this device's choice from
 * the command palette ("Recommend pages with Jev") overrides the build. */
const STORAGE_KEY = "oncobase:palette-jev";
const env = import.meta.env as Record<string, string | undefined>;

export function paletteJevEnabled() {
  const stored = safeLocalStorage.getItem(STORAGE_KEY);
  if (stored === "on") return true;
  if (stored === "off") return false;
  return env.VITE_PALETTE_JEV === "true";
}

export function setPaletteJevEnabled(enabled: boolean) {
  safeLocalStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
}
