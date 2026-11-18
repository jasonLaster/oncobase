import { safeLocalStorage } from "@oncobase/safe-storage";
import type { WikiPageRecord } from "@oncobase/wiki-content";
import type { StoragePressure } from "./types";

const RECENT_KEY = "cmd-palette-recent";
const LEGACY_RECENT_KEY = "wiki-vite-recent-slugs";
const ROUTE_CONTENT_SLUG_ALIASES = new Map([["about/index", "index"]]);

export function slugFromPath(pathname: string) {
  const decoded = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.(?:md|mdx)$/i, "");
  return decoded || "index";
}

export function contentSlugFromRouteSlug(routeSlug: string) {
  return ROUTE_CONTENT_SLUG_ALIASES.get(routeSlug.toLowerCase()) ?? routeSlug;
}

export function hrefForSlug(slug: string) {
  return slug === "index" ? "/" : `/${slug}`;
}

export function backendHref(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, "http://wiki.local");

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  const pathWithParams = `${url.pathname}${url.search}${url.hash}`;
  const origin =
    import.meta.env.VITE_WIKI_APP_ORIGIN ?? import.meta.env.VITE_WIKI_API_ORIGIN ?? "";

  if (!origin) return pathWithParams;

  return `${origin.replace(/\/+$/, "")}${pathWithParams}`;
}

export function returnToHref(pathname: string, search = "", hash = "") {
  return `${pathname}${search}${hash}`;
}

/** The sign-in link for a route, returning to it without an explicit `scope`.
 * Path-only (no origin), so it renders the same on the server. */
export function signInHrefFor(location: { pathname: string; search: string; hash: string }) {
  const returnUrl = new URL(location.pathname + location.search + location.hash, "http://reader.invalid");
  returnUrl.searchParams.delete("scope");
  return `/sign-in?redirect=${encodeURIComponent(returnUrl.pathname + returnUrl.search + returnUrl.hash)}`;
}

export function parseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function byteSize(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function formatBytes(value: number | null) {
  if (value == null) return "unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(value: number | null) {
  if (value == null) return "unknown";
  return `${Math.round(value * 100)}%`;
}

export function readRecentSlugs() {
  try {
    const parsed = JSON.parse(safeLocalStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    const legacy = JSON.parse(safeLocalStorage.getItem(LEGACY_RECENT_KEY) ?? "[]") as unknown;
    const primary = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    const migrated = Array.isArray(legacy)
      ? legacy.filter((item): item is string => typeof item === "string")
      : [];
    return [...primary, ...migrated.filter((slug) => !primary.includes(slug))];
  } catch {
    return [];
  }
}

export function rememberSlug(slug: string) {
  const next = [slug, ...readRecentSlugs().filter((item) => item !== slug)].slice(0, 12);
  try {
    safeLocalStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Local recency is best effort only.
  }
}

export async function storageSnapshot() {
  if (!navigator.storage?.estimate) {
    return { usage: null, quota: null, usageRatio: null, pressure: "unknown" as const };
  }
  // Diagnostics only: a failed estimate must never reject into sync paths.
  const estimate = await navigator.storage.estimate().catch(() => ({} as StorageEstimate));
  const usage = estimate.usage ?? null;
  const quota = estimate.quota ?? null;
  const usageRatio = usage != null && quota != null && quota > 0 ? usage / quota : null;
  let pressure: StoragePressure = "unknown";
  if (usageRatio != null) {
    pressure = usageRatio >= 0.95 ? "critical" : usageRatio >= 0.85 ? "warning" : "ok";
  }
  return { usage, quota, usageRatio, pressure };
}

export function normalizeFetchedPageSlug(
  requestedSlug: string,
  pages: WikiPageRecord[],
) {
  return pages.find((page) => page.slug === requestedSlug) ?? pages[0] ?? null;
}

export function isAuthError(error: unknown) {
  return error instanceof Error && /401|403/.test(error.message);
}
