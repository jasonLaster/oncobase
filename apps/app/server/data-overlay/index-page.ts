// The browsable index at data.diana-tnbc.com/: public datasets from
// public/manifest.json, plus the private objects this viewer may read.

import { PUBLIC_PREFIX, accessiblePrefixes, canAccessKey } from "./prefix-roles";
import { safeSegments, RESERVED_FIRST_SEGMENTS, urlPathForKey } from "./paths";
import type { DataOverlayStorage } from "./storage";

export const MANIFEST_KEY = `${PUBLIC_PREFIX}manifest.json`;
export const MANIFEST_CACHE_TTL_MS = 60_000;
/** A failed (not missing) manifest read is retried sooner. */
export const MANIFEST_ERROR_TTL_MS = 10_000;
export const PRIVATE_LIST_LIMIT = 1000;

export type ManifestDataset = {
  path: string;
  bytes: number | null;
  sha256: string | null;
  description: string | null;
  source: string | null;
  timepoint: string | null;
  deidentification: string | null;
  license: string | null;
};

export type IndexDataset = ManifestDataset & { url: string };
export type IndexPrivateObject = { key: string; url: string; bytes: number; lastModified: string | null };
export type DataIndex = {
  datasets: IndexDataset[];
  private: IndexPrivateObject[];
  privateTruncated: boolean;
  viewer: { email: string; roles: string[] } | null;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** Entries whose path cannot be served as a public URL are dropped. */
export function parseManifest(raw: string | null): ManifestDataset[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  const datasets = (parsed as { datasets?: unknown } | null)?.datasets;
  if (!Array.isArray(datasets)) return [];
  const output: ManifestDataset[] = [];
  for (const entry of datasets) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== "string") continue;
    const segments = safeSegments(item.path);
    if (!segments || RESERVED_FIRST_SEGMENTS.has(segments[0]!)) continue;
    if (!urlPathForKey(`${PUBLIC_PREFIX}${item.path}`)) continue;
    output.push({
      path: item.path,
      bytes: typeof item.bytes === "number" && Number.isFinite(item.bytes) ? item.bytes : null,
      sha256: text(item.sha256),
      description: text(item.description),
      source: text(item.source),
      timepoint: text(item.timepoint),
      deidentification: text(item.deidentification),
      license: text(item.license),
    });
  }
  return output;
}

/** The parsed manifest, shared in-process for MANIFEST_CACHE_TTL_MS. */
export function createManifestCache(storage: () => DataOverlayStorage | Promise<DataOverlayStorage>, now = () => Date.now()) {
  type Entry = { value: Promise<ManifestDataset[]>; expires: number };
  let entry: Entry | null = null;
  return function manifest() {
    const at = now();
    if (entry && entry.expires > at) return entry.value;
    const current: Entry = {
      expires: at + MANIFEST_CACHE_TTL_MS,
      value: Promise.resolve(storage())
        .then(store => store.readText(MANIFEST_KEY))
        .then(parseManifest)
        .catch((error: unknown) => {
          console.error("[data-overlay] manifest read failed", error instanceof Error ? error.message : error);
          current.expires = now() + MANIFEST_ERROR_TTL_MS;
          return [] as ManifestDataset[];
        }),
    };
    entry = current;
    return current.value;
  };
}

export async function buildDataIndex({
  manifest,
  storage,
  viewer,
}: {
  manifest: () => Promise<ManifestDataset[]>;
  storage: () => DataOverlayStorage | Promise<DataOverlayStorage>;
  viewer: { email: string; roles: string[] } | null;
}): Promise<DataIndex> {
  const datasets = (await manifest()).map(dataset => ({ ...dataset, url: urlPathForKey(`${PUBLIC_PREFIX}${dataset.path}`)! }));
  const privateObjects: IndexPrivateObject[] = [];
  let privateTruncated = false;
  const prefixes = viewer ? accessiblePrefixes(viewer.roles) : [];
  if (viewer && prefixes.length > 0) {
    const store = await storage();
    const listings = await Promise.all(prefixes.map(prefix => store.list(prefix, PRIVATE_LIST_LIMIT)));
    const seen = new Set<string>();
    for (const listing of listings) {
      privateTruncated ||= listing.truncated;
      for (const object of listing.objects) {
        if (seen.has(object.key) || object.key.endsWith("/")) continue;
        // ListObjectsV2 was scoped to the viewer's prefixes; check each key
        // against the policy again anyway.
        if (!canAccessKey(object.key, viewer.roles)) continue;
        const url = urlPathForKey(object.key);
        if (!url) continue;
        seen.add(object.key);
        privateObjects.push({ key: object.key, url, bytes: object.bytes, lastModified: object.lastModified });
      }
    }
    privateObjects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  return { datasets, private: privateObjects, privateTruncated, viewer };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function renderDataIndexHtml(index: DataIndex, { signInHref, canSignOut }: { signInHref: string; canSignOut: boolean }) {
  const cell = (value: string | null) => `<td>${value ? escapeHtml(value) : ""}</td>`;
  const datasetRows = index.datasets.map(dataset => `<tr><td><a href="${escapeHtml(dataset.url)}">${escapeHtml(dataset.path)}</a></td>${cell(formatBytes(dataset.bytes))}${cell(dataset.description)}${cell(dataset.source)}${cell(dataset.timepoint)}${cell(dataset.deidentification)}${cell(dataset.license)}<td><code>${escapeHtml(dataset.sha256 ?? "")}</code></td></tr>`).join("\n");
  const privateRows = index.private.map(object => `<tr><td><a href="${escapeHtml(object.url)}">${escapeHtml(object.key)}</a></td>${cell(formatBytes(object.bytes))}${cell(object.lastModified)}</tr>`).join("\n");
  const account = index.viewer
    ? `<p>Signed in as ${escapeHtml(index.viewer.email)}.${canSignOut ? ` <form method="post" action="/_auth/signout" style="display:inline"><button type="submit">Sign out</button></form>` : ""}</p>`
    : `<p><a href="${escapeHtml(signInHref)}">Sign in with your diana-tnbc.com account</a> to see private data you have access to.</p>`;
  const privateSection = index.viewer
    ? `<h2>Private</h2>${index.private.length
      ? `<table><thead><tr><th>Key</th><th>Size</th><th>Modified</th></tr></thead><tbody>${privateRows}</tbody></table>${index.privateTruncated ? "<p>Listing truncated.</p>" : ""}`
      : "<p>No private data is shared with this account.</p>"}`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Diana TNBC data</title>
<style>
:root { color-scheme: light dark; --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --line: #d1d9e0; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9198a1; --line: #3d444d; } }
body { font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0 auto; max-width: 72rem; padding: 1.5rem 1rem; }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
code { font-size: 12px; word-break: break-all; }
a { color: inherit; }
</style>
</head>
<body>
<h1>Diana TNBC data</h1>
${account}
<p>JSON: <a href="/index.json">/index.json</a>. Each link redirects to a short-lived download URL.</p>
<h2>Public</h2>
${index.datasets.length
    ? `<table><thead><tr><th>Path</th><th>Size</th><th>Description</th><th>Source</th><th>Timepoint</th><th>De-identification</th><th>License</th><th>SHA-256</th></tr></thead><tbody>${datasetRows}</tbody></table>`
    : "<p>No public datasets are listed yet.</p>"}
${privateSection}
</body>
</html>
`;
}
