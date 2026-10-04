import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyWikiTheme,
  getWikiThemePreference,
  setWikiThemePreference,
  subscribeWikiSystemTheme,
  subscribeWikiThemePreference,
  type WikiResolvedTheme,
} from "@oncobase/wiki-shell/theme";
import "./public-theme.css";

function subscribeTheme(listener: () => void) {
  const update = () => {
    applyWikiTheme();
    listener();
  };
  const unsubscribePreference = subscribeWikiThemePreference(update);
  const unsubscribeSystem = subscribeWikiSystemTheme(update);
  const onStorage = (event: StorageEvent) => {
    if (event.key === "theme" || event.key === null) update();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribePreference();
    unsubscribeSystem();
    window.removeEventListener("storage", onStorage);
  };
}

function systemTheme(): WikiResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolvedTheme(): WikiResolvedTheme {
  return getWikiThemePreference() ?? systemTheme();
}

/** The theme public pages are showing, following the system until chosen. */
export function useResolvedWikiTheme() {
  return useSyncExternalStore(subscribeTheme, resolvedTheme, () => "light");
}

export function PublicThemeControl() {
  const theme = useResolvedWikiTheme();
  useEffect(() => {
    applyWikiTheme();
  }, []);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="public-theme-control"
      aria-label="Dark theme"
      aria-pressed={dark}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        // Choosing the system's own theme returns to following the system.
        setWikiThemePreference(next === systemTheme() ? null : next);
      }}
    >
      {dark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </button>
  );
}
