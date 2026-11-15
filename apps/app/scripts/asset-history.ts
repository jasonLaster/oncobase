import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// Version skew (P22). A tab opened before a deploy still runs the previous
// build and lazily imports chunks by their old hashed names. Vercel serves
// /assets/* from each deployment's own static output, so without help those
// names 404 on the new deployment and the reader has to reload (main.tsx:
// vite:preloadError -> reloadOnceForLoadError), losing the reader's place.
//
// Each production build therefore copies the previous production builds'
// hashed assets into its own dist/assets before upload, and records what it
// carries in /assets/asset-history.json for the next build to read. Names are
// content hashes, so a carried file can never shadow a current one. Files
// older than the retention window are dropped and then 404 (no-store, see
// server/app-shell.ts) exactly as before, so the reload-once recovery is
// still the backstop. Nothing here can fail a deploy: every error is logged
// and the build continues with whatever was carried.

export const HISTORY_FILE = "asset-history.json";
export const MAX_BUILDS = 5;
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type AssetBuild = { id: string; builtAt: string; files: string[] };
export type AssetHistory = { version: 1; builds: AssetBuild[] };

const SAFE_NAME_RE = /^[\w-]+(?:\.[\w-]+)*(?:\/[\w-]+(?:\.[\w-]+)*)*$/;

export function isSafeAssetName(name: unknown): name is string {
  return typeof name === "string" && name.length <= 200 && SAFE_NAME_RE.test(name) && name !== HISTORY_FILE;
}

export function parseHistory(value: unknown): AssetHistory | null {
  if (!value || typeof value !== "object") return null;
  const { version, builds } = value as { version?: unknown; builds?: unknown };
  if (version !== 1 || !Array.isArray(builds)) return null;
  const parsed: AssetBuild[] = [];
  for (const build of builds) {
    if (!build || typeof build !== "object") continue;
    const { id, builtAt, files } = build as Record<string, unknown>;
    if (typeof id !== "string" || typeof builtAt !== "string" || !Array.isArray(files)) continue;
    if (Number.isNaN(Date.parse(builtAt))) continue;
    parsed.push({ id, builtAt, files: files.filter(isSafeAssetName) });
  }
  return { version: 1, builds: parsed };
}

/** The previous builds worth keeping, newest first, excluding the current id. */
export function retainedBuilds(previous: AssetHistory | null, currentId: string, now: number): AssetBuild[] {
  return (previous?.builds ?? [])
    .filter(build => build.id !== currentId && now - Date.parse(build.builtAt) <= MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.builtAt) - Date.parse(a.builtAt))
    .slice(0, MAX_BUILDS - 1);
}

export function filesToCarry(retained: AssetBuild[], currentFiles: Iterable<string>): string[] {
  const current = new Set(currentFiles);
  const carry = new Set<string>();
  for (const build of retained) for (const file of build.files) if (!current.has(file)) carry.add(file);
  return [...carry].sort();
}

export function listAssetFiles(assetsDir: string): string[] {
  if (!existsSync(assetsDir)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const name = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, name);
      else if (name !== HISTORY_FILE) out.push(name);
    }
  };
  walk(assetsDir, "");
  return out.sort();
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type CarryOptions = {
  distDir: string;
  /** e.g. https://diana-tnbc.com; null skips carrying but still writes history. */
  origin: string | null;
  buildId: string;
  now?: number;
  fetch?: Fetch;
  concurrency?: number;
  log?: (message: string) => void;
};

export type CarryResult = { carried: string[]; missing: string[]; history: AssetHistory };

async function fetchWithTimeout(fetcher: Fetch, url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetcher(url, { signal: controller.signal, headers: { "User-Agent": "oncobase-vercel-build" } });
  } finally {
    clearTimeout(timer);
  }
}

export async function carryPreviousAssets(options: CarryOptions): Promise<CarryResult> {
  const { distDir, origin, buildId } = options;
  const now = options.now ?? Date.now();
  const fetcher = options.fetch ?? fetch;
  const log = options.log ?? console.log;
  const assetsDir = path.join(distDir, "assets");
  const currentFiles = listAssetFiles(assetsDir);

  let previous: AssetHistory | null = null;
  if (origin) {
    try {
      // The query sidesteps any cached copy; a stale history would only carry fewer files.
      const response = await fetchWithTimeout(fetcher, `${origin}/assets/${HISTORY_FILE}?build=${encodeURIComponent(buildId)}`, 10_000);
      if (response.ok) previous = parseHistory(await response.json());
      else log(`Asset history: ${origin} returned ${response.status}; nothing to carry.`);
    } catch (error) {
      log(`Asset history: could not read ${origin}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    log("Asset history: no production origin; nothing to carry.");
  }

  const retained = retainedBuilds(previous, buildId, now);
  const wanted = filesToCarry(retained, currentFiles);
  const carried: string[] = [];
  const missing: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const file = wanted[next++];
      try {
        const response = await fetchWithTimeout(fetcher, `${origin}/assets/${file}`, 20_000);
        if (!response.ok) {
          missing.push(file);
          continue;
        }
        const target = path.join(assetsDir, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, new Uint8Array(await response.arrayBuffer()));
        carried.push(file);
      } catch {
        missing.push(file);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 8) }, worker));

  // Record only files this deployment actually serves, so a file that could
  // not be fetched is not asked for again by the next build.
  const present = new Set([...currentFiles, ...carried]);
  const history: AssetHistory = {
    version: 1,
    builds: [
      { id: buildId, builtAt: new Date(now).toISOString(), files: currentFiles },
      ...retained.map(build => ({ ...build, files: build.files.filter(file => present.has(file)) })),
    ],
  };
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(path.join(assetsDir, HISTORY_FILE), JSON.stringify(history));
  log(
    `Asset history: carried ${carried.length} file(s) from ${retained.length} previous build(s)` +
      (missing.length ? `; ${missing.length} no longer available` : "") + ".",
  );
  return { carried: carried.sort(), missing: missing.sort(), history };
}

export function assetHistoryOrigin(env: Record<string, string | undefined>): string | null {
  const explicit = env.WIKI_ASSET_HISTORY_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : null;
}
