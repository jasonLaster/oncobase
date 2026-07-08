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

const totalGzipBudget = 1_300_000;

/**
 * Lazy on-demand chunks that should not count against the initial-load budget.
 *
 * The reader entry never references these directly: they are pulled in via
 * `lazy(() => import("@oncobase/wiki-markdown/mermaid"))` (and through
 * mermaid's own dynamic `import("./diagrams/...")` splits) only when the
 * current markdown contains a mermaid fence. We allowlist the mermaid-related
 * sub-chunk names produced by Vite's bundler so the eager-asset budget tracks
 * the bytes a reader actually downloads before paint.
 */
const lazyChunkPatterns: RegExp[] = [
  /^mermaid[\w.-]*\.js$/,
  /^mermaid-parser\.core-[\w-]+\.js$/,
  // Mermaid diagram-kind splits, including ones whose prefix mixes digits
  // (e.g. `c4Diagram`).
  /^[A-Za-z0-9]+Diagram-[\w-]+\.js$/,
  /^(?:diagram|architecture|gitGraph|treemap|treeView|wardley|radar|info|pie|packet)-[\w-]+\.js$/,
  // Mermaid diagram definitions split by kind.
  /^(?:timeline|mindmap|kanban|class|state|sequence|flow|gantt|requirement|block|venn|xychart|er|usecase|journey|quadrant|sankey|c4)-(?:definition|diagram)-[\w-]+\.js$/i,
  // Mermaid graph engines (transitively imported by diagram chunks, not the
  // reader entry).
  /^cytoscape[\w.-]*\.js$/,
  /^cose-bilkent-[\w-]+\.js$/,
  /^dagre[\w-]*-[\w-]+\.js$/,
  /^graphlib-[\w-]+\.js$/,
  /^rough\.esm-[\w-]+\.js$/,
  // Hash-only chunks (lodash sub-deps and mermaid internals) — none of these
  // are statically referenced from the entry or page chunks; verified via
  // `import` grep against the dist tree.
  /^chunk-[\w-]+\.js$/,
  /^(?:dist|isEmpty|reduce|highlighted-body|_baseFor|development|c4Diagram)-[\w-]+\.js$/,
  // Liveblocks-backed comments are loaded from document and comments routes
  // through React.lazy. Keep the package and Liveblocks runtime out of the
  // eager shell budget.
  /^comments-liveblocks-[\w-]+\.js$/,
  /^wrapper-[\w-]+\.js$/,
  /^page-client-[\w-]+\.js$/,
  /^threads-[\w-]+\.js$/,
];
const lazyChunkGzipBudget = 1_200_000;

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

function isLazyChunk(asset: AssetSize) {
  return lazyChunkPatterns.some((pattern) => pattern.test(asset.name));
}

const eagerAssets = assets.filter((asset) => !isLazyChunk(asset));
const lazyAssets = assets.filter(isLazyChunk);
const eagerGzipBytes = eagerAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const lazyGzipBytes = lazyAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const totalGzipBytes = eagerGzipBytes + lazyGzipBytes;

if (eagerGzipBytes > totalGzipBudget) {
  failures.push(
    `eager assets: ${formatBytes(eagerGzipBytes)} gzip > ${formatBytes(totalGzipBudget)}`,
  );
}
if (lazyGzipBytes > lazyChunkGzipBudget) {
  failures.push(
    `lazy assets: ${formatBytes(lazyGzipBytes)} gzip > ${formatBytes(lazyChunkGzipBudget)}`,
  );
}

console.log("Wiki Vite bundle budget");
console.log(
  `dist assets gzip total: ${formatBytes(totalGzipBytes)} ` +
    `(eager ${formatBytes(eagerGzipBytes)} / lazy ${formatBytes(lazyGzipBytes)})`,
);
for (const asset of assets) {
  console.log(`${asset.name.padEnd(38)} raw ${formatBytes(asset.bytes).padStart(10)} gzip ${formatBytes(asset.gzipBytes).padStart(10)}`);
}

if (failures.length > 0) {
  console.error("\nBundle budget failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
