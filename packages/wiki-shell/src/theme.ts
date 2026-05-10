export type WikiThemePreference = "dark" | "light" | null;
export type WikiResolvedTheme = "dark" | "light";

const THEME_STORAGE_KEY = "theme";
const themeListeners = new Set<() => void>();

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function prefersDark() {
  return canUseDom() && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getWikiThemePreference(): WikiThemePreference {
  if (!canUseDom()) return null;
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" ? value : null;
}

export function wikiThemeLabel(preference: WikiThemePreference = getWikiThemePreference()) {
  if (preference === "dark") return "Dark";
  if (preference === "light") return "Light";
  return "System";
}

export function applyWikiTheme(): WikiResolvedTheme {
  if (!canUseDom()) return "light";
  const preference = getWikiThemePreference();
  const resolved: WikiResolvedTheme =
    preference === "dark" || (preference === null && prefersDark()) ? "dark" : "light";

  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function setWikiThemePreference(preference: WikiThemePreference) {
  if (!canUseDom()) return;
  if (preference === null) {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }
  applyWikiTheme();
  for (const listener of themeListeners) listener();
}

export function cycleWikiThemePreference() {
  const preference = getWikiThemePreference();
  const systemTheme: WikiResolvedTheme = prefersDark() ? "dark" : "light";

  if (preference === null) {
    setWikiThemePreference(systemTheme === "dark" ? "light" : "dark");
  } else if (preference === "dark") {
    setWikiThemePreference("light");
  } else {
    setWikiThemePreference(null);
  }
}

export function subscribeWikiThemePreference(listener: () => void) {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function subscribeWikiSystemTheme(listener: () => void) {
  if (!canUseDom()) return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

