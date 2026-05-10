import type { WikiManifest, WikiPageRecord } from "@diana-tnbc/wiki-content";
import { events } from "./livestore/schema";
import type { StoragePressure } from "./types";

const RECENT_KEY = "wiki-vite-recent-slugs";

export function slugFromPath(pathname: string) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\/+$/, "");
  return decoded || "index";
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
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberSlug(slug: string) {
  const next = [slug, ...readRecentSlugs().filter((item) => item !== slug)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Local recency is best effort only.
  }
}

export async function storageSnapshot() {
  if (!navigator.storage?.estimate) {
    return { usage: null, quota: null, usageRatio: null, pressure: "unknown" as const };
  }
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? null;
  const quota = estimate.quota ?? null;
  const usageRatio = usage != null && quota != null && quota > 0 ? usage / quota : null;
  let pressure: StoragePressure = "unknown";
  if (usageRatio != null) {
    pressure = usageRatio >= 0.95 ? "critical" : usageRatio >= 0.85 ? "warning" : "ok";
  }
  return { usage, quota, usageRatio, pressure };
}

export function manifestToEvent(manifest: WikiManifest, receivedAt: number) {
  return events.manifestApplied({
    siteSlug: manifest.siteSlug,
    scope: manifest.scope,
    manifestHash: manifest.manifestHash,
    generatedAt: manifest.generatedAt,
    receivedAt,
    manifestSize: byteSize(JSON.stringify(manifest)),
    compactTreeJson: JSON.stringify(manifest.compactTree),
    pagesJson: JSON.stringify(manifest.pages),
    assetsJson: JSON.stringify(manifest.assets),
  });
}

export function pageToEvent(page: WikiPageRecord) {
  return events.pageContentFetched({
    slug: page.slug,
    title: page.title,
    content: page.content,
    tags: page.tags,
    contentHash: page.contentHash,
    sensitive: page.sensitive,
    size: page.size,
    fetchedAt: Date.now(),
  });
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
