import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const distDir = path.resolve(import.meta.dir, "../dist");
const assetsDir = path.join(distDir, "assets");

type AssetSize = {
  name: string;
  bytes: number;
  gzipBytes: number;
};

type Budget = {
  label: string;
  pattern: RegExp;
  maxBytes?: number;
  maxGzipBytes?: number;
};

const budgets: Budget[] = [
  { label: "entry", pattern: /^index-[\w-]+\.js$/, maxGzipBytes: 20_000 },
  { label: "react vendor", pattern: /^vendor-react-[\w-]+\.js$/, maxGzipBytes: 75_000 },
  { label: "livestore vendor", pattern: /^vendor-livestore-[\w-]+\.js$/, maxGzipBytes: 95_000 },
  { label: "effect vendor", pattern: /^vendor-effect-[\w-]+\.js$/, maxGzipBytes: 140_000 },
  { label: "markdown vendor", pattern: /^vendor-markdown-[\w-]+\.js$/, maxGzipBytes: 150_000 },
  { label: "page chunk", pattern: /^WikiPage-[\w-]+\.js$/, maxGzipBytes: 125_000 },
  { label: "chat chunk", pattern: /^ChatPage-[\w-]+\.js$/, maxGzipBytes: 110_000 },
  { label: "sync/shared shell chunks", pattern: /^(?:WikiSync|outline|src)-[\w-]+\.js$/, maxGzipBytes: 45_000 },
  { label: "livestore shell chunk", pattern: /^LiveStoreRoot-[\w-]+\.js$/, maxGzipBytes: 15_000 },
  { label: "shared worker", pattern: /^make-shared-worker-[\w-]+\.js$/, maxBytes: 430_000 },
  { label: "livestore worker", pattern: /^livestore\.worker-[\w-]+\.js$/, maxBytes: 620_000 },
  { label: "sqlite wasm", pattern: /^wa-sqlite-[\w-]+\.wasm$/, maxBytes: 680_000 },
];

/**
 * Eager assets are the bytes a reader downloads before a wiki page paints:
 *
 * - the static-import closure of the entry chunk plus the two dynamic roots
 *   every page view takes (`LiveStoreRoot`, the reader shell, and `WikiPage`,
 *   the default route), and
 * - the LiveStore workers, the SQLite wasm, and the single eager stylesheet,
 *   which load at boot outside the module graph.
 *
 * Everything else — mermaid diagram splits, the chat page, admin routes, the
 * lazily imported markdown title/body renderers — only downloads when its
 * dynamic import runs, and counts against the lazy budget instead.
 *
 * Classification walks the actual `import`/`from` specifiers in the built
 * chunks rather than a hand-maintained filename allowlist, so a chunk that
 * gets statically pulled onto the critical path shows up as an eager
 * regression instead of being silently misfiled by its name.
 */
const eagerRootPatterns = [
  /^index-[\w-]+\.js$/,
  /^LiveStoreRoot-[\w-]+\.js$/,
  /^WikiPage-[\w-]+\.js$/,
];
const eagerLoaderPatterns = [
  /^livestore\.worker-[\w-]+\.js$/,
  /^make-shared-worker-[\w-]+\.js$/,
  /^wa-sqlite-[\w-]+\.wasm$/,
  /\.css$/,
];

const eagerGzipBudget = 1_180_000;
// The DICOM/Cornerstone suite (decoders, wasm codecs, vtk) is fully
// on-demand and dominates the lazy pool; it is not first-load critical.
const lazyGzipBudget = 3_100_000;

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function readAssetSizes() {
  return readdirSync(assetsDir)
    .filter((name) => statSync(path.join(assetsDir, name)).isFile())
    .map((name): AssetSize => {
      const contents = readFileSync(path.join(assetsDir, name));
      return {
        name,
        bytes: contents.byteLength,
        gzipBytes: gzipSync(contents).byteLength,
      };
    })
    .sort((a, b) => b.gzipBytes - a.gzipBytes);
}

/**
 * Static import specifiers (`import ... from "./x.js"`, `import "./x.js"`,
 * `export ... from "./x.js"`) in rolldown output are double-quoted; dynamic
 * imports are emitted as `import(\`./x.js\`)` through a preload helper, so
 * they never match here and their targets stay classified as lazy.
 */
function staticImports(source: string): Set<string> {
  const deps = new Set<string>();
  for (const match of source.matchAll(/(?:from\s*|import\s*)"\.\/([^"]+\.js)"/g)) {
    deps.add(match[1]);
  }
  return deps;
}

function eagerAssetNames(assets: AssetSize[]): Set<string> {
  const jsNames = new Set(assets.filter((a) => a.name.endsWith(".js")).map((a) => a.name));
  const graph = new Map<string, string[]>();
  for (const name of jsNames) {
    const source = readFileSync(path.join(assetsDir, name), "utf8");
    graph.set(name, [...staticImports(source)].filter((dep) => jsNames.has(dep)));
  }

  const eager = new Set<string>();
  const queue = assets
    .filter((asset) => eagerRootPatterns.some((pattern) => pattern.test(asset.name)))
    .map((asset) => asset.name);
  while (queue.length > 0) {
    const current = queue.pop();
    if (current == null || eager.has(current)) continue;
    eager.add(current);
    queue.push(...(graph.get(current) ?? []));
  }

  for (const asset of assets) {
    if (eagerLoaderPatterns.some((pattern) => pattern.test(asset.name))) {
      eager.add(asset.name);
    }
  }
  return eager;
}

function assertBudget(asset: AssetSize, budget: Budget) {
  const failures = [];
  if (budget.maxBytes != null && asset.bytes > budget.maxBytes) {
    failures.push(`${formatBytes(asset.bytes)} raw > ${formatBytes(budget.maxBytes)}`);
  }
  if (budget.maxGzipBytes != null && asset.gzipBytes > budget.maxGzipBytes) {
    failures.push(`${formatBytes(asset.gzipBytes)} gzip > ${formatBytes(budget.maxGzipBytes)}`);
  }
  return failures;
}

const assets = readAssetSizes();
const failures: string[] = [];

for (const budget of budgets) {
  const matches = assets.filter((asset) => budget.pattern.test(asset.name));
  if (matches.length === 0) {
    failures.push(`${budget.label}: missing chunk matching ${budget.pattern}`);
    continue;
  }

  for (const asset of matches) {
    const budgetFailures = assertBudget(asset, budget);
    for (const failure of budgetFailures) {
      failures.push(`${budget.label}: ${asset.name} ${failure}`);
    }
  }
}

for (const pattern of eagerRootPatterns) {
  if (!assets.some((asset) => pattern.test(asset.name))) {
    failures.push(`eager root: missing chunk matching ${pattern}`);
  }
}

const eagerNames = eagerAssetNames(assets);
const eagerAssets = assets.filter((asset) => eagerNames.has(asset.name));
const lazyAssets = assets.filter((asset) => !eagerNames.has(asset.name));
const eagerGzipBytes = eagerAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const lazyGzipBytes = lazyAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const totalGzipBytes = eagerGzipBytes + lazyGzipBytes;

if (eagerGzipBytes > eagerGzipBudget) {
  failures.push(
    `eager assets: ${formatBytes(eagerGzipBytes)} gzip > ${formatBytes(eagerGzipBudget)}`,
  );
}
if (lazyGzipBytes > lazyGzipBudget) {
  failures.push(
    `lazy assets: ${formatBytes(lazyGzipBytes)} gzip > ${formatBytes(lazyGzipBudget)}`,
  );
}

console.log("Wiki Vite bundle budget");
console.log(
  `dist assets gzip total: ${formatBytes(totalGzipBytes)} ` +
    `(eager ${formatBytes(eagerGzipBytes)} / lazy ${formatBytes(lazyGzipBytes)})`,
);
for (const asset of assets) {
  const marker = eagerNames.has(asset.name) ? "eager" : "lazy ";
  console.log(`${marker} ${asset.name.padEnd(38)} raw ${formatBytes(asset.bytes).padStart(10)} gzip ${formatBytes(asset.gzipBytes).padStart(10)}`);
}

if (failures.length > 0) {
  console.error("\nBundle budget failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
