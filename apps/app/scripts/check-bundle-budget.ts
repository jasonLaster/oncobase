import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync as fflateGzip } from "fflate";
import { serverBudgetFailures } from "./reader-server-budget";
import { entryChunkName, exactName } from "./bundle-entry";

const distDir = path.resolve(import.meta.dir, "../dist");
const assetsDir = path.join(distDir, "assets");

const entryName = existsSync(assetsDir) ? entryChunkName(
  existsSync(path.join(distDir, "index.html")) ? readFileSync(path.join(distDir, "index.html"), "utf8") : null,
  readdirSync(assetsDir).filter(name => name.endsWith(".js")).map(name => ({ name, source: () => readFileSync(path.join(assetsDir, name), "utf8") })),
) : "index-missing.js";

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

// Vendor chunks now own their transitive dependencies formerly emitted in
// app/shared chunks. Only per-chunk allocation changes; aggregate limits stay fixed.
const budgets: Budget[] = [
  // The identity boundary and its shared client helpers now belong to the
  // entry. This moves existing eager bytes; the aggregate limit is unchanged.
  { label: "entry", pattern: exactName(entryName), maxGzipBytes: 24_904 },
  { label: "react vendor", pattern: /^vendor-react-[\w-]+\.js$/, maxGzipBytes: 78_048 },
  { label: "livestore vendor", pattern: /^vendor-livestore-[\w-]+\.js$/, maxGzipBytes: 108_104 },
  { label: "effect vendor", pattern: /^vendor-effect-[\w-]+\.js$/, maxGzipBytes: 145_000 },
  // The raw-HTML stage (rehype-raw, parse5) left vendor-markdown for its own
  // lazy chunk, loaded only for documents with HTML (wiki-markdown raw-html.ts):
  // vendor-markdown 107.2 -> 53.8 KiB, vendor-rawhtml 50.8 KiB.
  { label: "markdown vendor", pattern: /^vendor-markdown-[\w-]+\.js$/, maxGzipBytes: 59_216 },
  { label: "raw-HTML vendor", pattern: /^vendor-rawhtml-[\w-]+\.js$/, maxGzipBytes: 53_088 },
  { label: "optional math vendor", pattern: /^vendor-math-[\w-]+\.js$/, maxGzipBytes: 87_576 },
  { label: "chat chunk", pattern: /^ChatPage-[\w-]+\.js$/, maxGzipBytes: 114_408 },
  { label: "PDF viewer", pattern: /^PdfViewerPage-[\w-]+\.js$/, maxGzipBytes: 145_408 },
  { label: "PDF worker", pattern: /^pdf\.worker\.min-[\w-]+\.mjs$/, maxGzipBytes: 401_784 },
  // WikiSync now lives in the StoreHost chunk (budgeted below).
  { label: "sync/shared shell chunks", pattern: /^(?:WikiSync|outline|src)-[\w-]+\.js$/, maxGzipBytes: 46_856 },
  // The bootstrap bridge adds a small provider hook and fetch exemption. Keep
  // the payload parser separate, but count its runtime cost as eager below.
  // Navigation seeding adds a store-local WeakMap and a second bootstrap ID.
  // Allow 64 bytes for shared-import symbol churn from the startup shortcut bridge.
  // The shared page-copy and mobile-chat glyphs restore the legacy artwork.
  // The account and saved-sidebar bridge measures under 17,344 gzip bytes.
  // Allow its 240-byte increase while retaining the aggregate eager budget.
  // Includes the bounded, read-only leader-lock probe for follower recovery.
  // The early reader keeps one app mounted across the real store handoff.
  // Allow 256 additional bytes here; retain the aggregate eager limit.
  // The initial identity preview adds a nullable-store gate and initial partition latch (+128 bytes).
  // Cached page/tree presentation and the deferred snapshot writer plus the shared tree expansion state add <832 bytes here.
  // Aggregate eager limits remain unchanged.
  // Allow 1 KiB more for slow-transfer controls and network-aware boot deadlines
  // in this reader chunk. Keep the entry and aggregate eager limits unchanged.
  // Scoped route/article/comments error boundaries and the external transfer
  // progress store add <384 bytes; aggregate eager limits remain unchanged.
  // Boot sub-phase telemetry (worker factory marks, LiveStore measure
  // observers, timeout classification) and the worker-script warm-up add
  // ~650 bytes (20,278 -> 20,925 gzip). Allow 1 KiB; aggregate eager limits unchanged.
  // The guarded OPFS fast-path reader (pool-header decode, SQLite header checks,
  // two-read comparison) must run before the adapter returns, so it stays in
  // this chunk: +1,148 bytes (20,929 -> 22,077 gzip). Allow 22 KiB; aggregate
  // eager limits unchanged.
  // The session handoff (SessionHandoffSync host, handoff span) landed in the
  // same chunk: 22,077 -> ~22.2 KiB gzip. Allow 22.75 KiB.
  // P1/P2 split the former LiveStoreRoot chunk (24,491 B gzip at d2a22f8f8,
  // over its 23,296 B budget) in two. Its React half (ReaderRoot: presentation,
  // handoff state) now ships inside the paint-critical WikiViteRoot chunk; its
  // store half (adapters, provider, deadlines, fallback reasons, sync and cache
  // services) is StoreHost, which loads after the article paints. Measured:
  // WikiViteRoot 3.5 KiB -> 21.7 KiB (it now holds ReaderRoot, App, the shell
  // and WikiPage, formerly in LiveStoreRoot), StoreHost 10.2 KiB (with
  // WikiSync, formerly its own 5.4 KiB chunk). Budgets: measured plus ~2.5%.
  // Main's WebMCP agent-tools loader moved here with the rest of LiveStoreRoot's
  // React half; it carries the +256 B main approved for it on 2026-11-14.
  // "Talk with the page" adds its launcher host, open-state store and the
  // mobile Talk/Ask button group: 23,314 -> 23,798 B gzip. Allow 24,000; the
  // call itself (transport, avatar states, styles) loads lazily.
  { label: "reader paint chunk", pattern: /^WikiViteRoot-[\w-]+\.js$/, maxGzipBytes: 24_000 },
  // A1 step 1 moved WikiSync's effects into a plain, unit-tested
  // SyncController: 10,959 -> 11,312 B gzip (raw is smaller; the denser code
  // compresses worse). +256 B; the store pool total is unchanged.
  { label: "store host chunk", pattern: /^StoreHost-[\w-]+\.js$/, maxGzipBytes: 11_376 },
  { label: "shared worker", pattern: /^make-shared-worker-[\w-]+\.js$/, maxBytes: 430_000 },
  { label: "livestore worker", pattern: /^livestore\.worker-[\w-]+\.js$/, maxBytes: 620_000 },
  { label: "sqlite wasm", pattern: /^wa-sqlite-[\w-]+\.wasm$/, maxBytes: 680_000 },
];

/**
 * Eager assets are the bytes a cold reader downloads at boot, in two classes:
 *
 * - paint-critical: the static-import closure of the entry chunk and of
 *   `WikiViteRoot` (session bootstrap, ReaderRoot, the shell, the default
 *   `WikiPage` and the markdown renderer), plus the single eager stylesheet.
 *   The article paints once these have arrived.
 * - store: the closure of `StoreHost` and `seed-page` that the paint set does
 *   not already hold (Effect, LiveStore, the schema), plus the LiveStore
 *   workers and the SQLite wasm, which load outside the module graph. The
 *   document starts these only after the paint set has arrived.
 *
 * Everything else — mermaid diagram splits, the chat page, admin routes, the
 * specialist route renderers — only downloads when its
 * dynamic import runs, and counts against the lazy budget instead.
 *
 * Classification walks the actual `import`/`from` specifiers in the built
 * chunks rather than a hand-maintained filename allowlist, so a chunk that
 * gets statically pulled onto the critical path shows up as an eager
 * regression instead of being silently misfiled by its name.
 */
const paintRootPatterns = [
  exactName(entryName),
  /^WikiViteRoot-[\w-]+\.js$/,
];
const storeRootPatterns = [
  /^StoreHost-[\w-]+\.js$/,
  /^seed-page-[\w-]+\.js$/,
];
const eagerRootPatterns = [...paintRootPatterns, ...storeRootPatterns];
const paintLoaderPatterns = [/\.css$/];
const storeLoaderPatterns = [
  /^livestore\.worker-[\w-]+\.js$/,
  /^make-shared-worker-[\w-]+\.js$/,
  /^wa-sqlite-[\w-]+\.wasm$/,
];

// Comments adds a small eager sliver (lazy-mount wrapper + pinned sidebar
// link); Liveblocks itself stays lazy. The public first-frame snapshot bridge
// adds a bounded ~3 KiB so warm reloads paint before OPFS replay completes.
// Client route metadata replacement adds less than 0.5 KiB across the default
// page and shared title helper.
// The temporary-reader fallback adds ~6 KiB gzip (<0.6%) to the shared
// LiveStore graph. Budget that measured compatibility cost explicitly; the
// fallback prevents an infinite loader when the browser denies OPFS access.
// Bounded OPFS lock acquisition adds less than 0.5 KiB across the worker and
// SQLite graph. Keep this explicit rather than obscuring the readiness fix.
// Content first (P1/P2, d2a22f8f8 -> this change). Eager was 1,205.9 KiB, over
// the former 1,233,500 B (1,204.6 KiB) limit, and it left out WikiViteRoot
// (3.5 KiB): the old roots were the entry, LiveStoreRoot and seed-page, and
// WikiViteRoot is a dynamic import of the entry that every reader view takes
// before it paints. Counted correctly that baseline is 1,209.4 KiB. This
// change measures 1,210.6 KiB (+1.2 KiB: the early-request head script hooks,
// the session payload parser, store fallback reasons and the runtime-download
// gate); lazy fell 3,873.4 -> 3,869.9 KiB, so the total grew 1.2 KiB. The
// eager limit is that measurement plus 0.3 KiB: 1,233,500 -> 1,240,000 B.
// The two classes get their own limits from measured sizes plus ~1%:
// paint-critical 407.8 KiB, store 802.8 KiB. A paint regression costs article
// time on every cold load; a store regression costs only store-boot time.
// Phase 1 integration: the drug-term tooltip (base-ui tooltip + floating-ui,
// 38.0 KiB) moved from paint-critical to lazy; it loads when the first drug
// term renders. Paint 408.8 -> 371.4 KiB, so its limit drops 421,000 ->
// 384,000 B. Eager measured 1,211.7 KiB with safe storage (A5), the manifest
// token (P6) and Back/Forward scroll memory merged, 1,174.2 KiB after the move:
// 1,240,000 -> 1,212,000 B. Lazy rises by the moved bytes, 3,990,000 ->
// 4,028,000 B; the total did not grow.
// Raw HTML on demand: rehype-raw and parse5 (vendor-rawhtml, 50.8 KiB) load only
// for documents that hold HTML, and the chat renderer's sanitizer helpers left
// vendor-markdown for the chat and math chunks. Paint 371.6 -> 319.4 KiB
// (-52.2 KiB): 384,000 -> 330,000 B. Eager 1,174.4 -> 1,122.2 KiB:
// 1,212,000 -> 1,155,000 B. Lazy 3,908.0 -> 3,963.5 KiB (+55.5 KiB: the moved
// bytes, ~2 KiB of gzip overhead from compressing them as separate chunks and
// ~1 KiB of new detection code): 4,028,000 -> 4,085,000 B. The eager + lazy
// limit stays 5,240,000 B.
// Smart-table loads @chenglou/pretext when a table nears the viewport, so the
// 14.7 KiB text-measurement chunk left the paint set. Paint 319.4 -> 306.5 KiB:
// 330,000 -> 322,000 B. The same 8,000 B move to the lazy pool, which also took
// main's lazy WebMCP tools on rebase: eager 1,155,000 -> 1,147,000 B, lazy
// 4,085,000 -> 4,093,000 B. The eager + lazy limit stays 5,240,000 B.
// The entry is now identified from index.html (bundle-entry.ts): swr's own
// `index-<hash>.js` (5,022 B gzip, loaded only by the DICOM and pathology
// routes) had matched the entry pattern and counted as paint-critical.
// Same build, before -> after: paint 320.2 -> 314.9 KiB, lazy 4,115.7 ->
// 4,121.1 KiB; no download changed. Move 5,000 B of allowance with it:
// paint 332,000 -> 327,000, eager 1,184,000 -> 1,179,000, lazy 4,217,000 ->
// 4,222,000 (below). The eager + lazy limit is unchanged.
// The command palette's own modules (palette.tsx, command-palette-pages.ts and
// fuzzysort) left the @oncobase/wiki-shell index: a module the index re-exports
// was placed with the index, in the shell chunk the article needs. Only the
// lazy CommandPalette chunk uses them, now through subpaths. Same base, before
// -> after (fflate gzip): shell chunk src-* 20,811 -> 16,315 B, paint
// 322,464 -> 317,967 B (-4,497 B), lazy +4.2 KiB, total unchanged. Allowance
// moves with it: paint 327,000 -> 322,500, eager 1,179,000 -> 1,174,500, lazy
// 4,222,000 -> 4,226,500.
const eagerGzipBudget = 1_174_500;
const paintGzipBudget = 322_500;
const storeGzipBudget = 855_000;
// The DICOM/Cornerstone suite (decoders, wasm codecs, vtk) is fully
// on-demand and dominates the lazy pool; it is not first-load critical.
// Current production is 3330.4 KiB; the public landing and education reader
// add 7.2 KiB. Account for that measured total without increasing eager limits.
// The dedicated public education application adds about 5 KiB of lazy JavaScript.
// Include its routing and navigation while retaining the eager budget.
// The public features and comparison pages (with their interactive demos and the shared
// public header) add about 28.6 KiB of lazy JavaScript and load only on /features and
// /compare, never in the reader or on the landing page: 3_428_000 -> 3_460_000.
// The oncobase.io home page and its not-found page add about 4.4 KiB more, also loaded only
// on that host: 3_460_000 -> 3_468_000.
// PDF.js adds ~495 KiB gzip, exclusively on the PDF route (viewer + worker).
// The reader's eager budget is unchanged; fonts/codecs load only when needed.
// The file palette's Jev recommendations and word/folder-aware ranking add about
// 1.5 KiB to the lazy CommandPalette chunk (Vercel builds measure ~0.8 KiB above
// local ones): 4_226_500 -> 4_229_000.
// "Talk with the page" adds a 6.7 KiB lazy call chunk (WebRTC transport, page
// conversation, call UI with its own styles), loaded only when a reader opens
// Talk: 4_229_000 -> 4_235_000. The call chunk then took on the avatar's
// styles (7.8 KiB), and Vercel measured 4136.2 KiB: 4_235_000 -> 4_238_000.
const lazyGzipBudget = 4_238_000;

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * Fingerprinted page images (scripts/optimize-images.ts) are not code: each loads only when an
 * `<img>` that needs it is on screen, already compressed, so they get a per-file size limit
 * instead of counting toward the JavaScript/WASM pools above.
 */
const imagePattern = /\.(?:avif|webp|png|jpe?g|gif)$/i;
const maxImageBytes = 125_000;

/**
 * Gzip size with fflate (pure JS, level 6), so macOS, Linux CI and the Vercel
 * build measure identical bytes. node:zlib links a different zlib per
 * platform: Vercel measured byte-identical files (wasm, pdf.worker) about 1%
 * larger than macOS did, which failed production builds that passed locally.
 * Budgets moved from node:zlib on macOS to fflate on 2026-11-15, each scaled by
 * its own measured ratio (about 1.03) on one build, so headroom is unchanged.
 */
const gzipSize = (contents: Uint8Array) => fflateGzip(contents, { level: 6 }).byteLength;

function readAssetSizes() {
  return readdirSync(assetsDir)
    .filter((name) => statSync(path.join(assetsDir, name)).isFile() && !imagePattern.test(name))
    .map((name): AssetSize => {
      const contents = readFileSync(path.join(assetsDir, name));
      return {
        name,
        bytes: contents.byteLength,
        gzipBytes: gzipSize(contents),
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

function closure(assets: AssetSize[], roots: RegExp[], loaders: RegExp[], graph: Map<string, string[]>) {
  const found = new Set<string>();
  const queue = assets.filter((asset) => roots.some((pattern) => pattern.test(asset.name))).map((asset) => asset.name);
  while (queue.length > 0) {
    const current = queue.pop();
    if (current == null || found.has(current)) continue;
    found.add(current);
    queue.push(...(graph.get(current) ?? []));
  }
  for (const asset of assets) {
    if (loaders.some((pattern) => pattern.test(asset.name))) found.add(asset.name);
  }
  return found;
}

function eagerAssetClasses(assets: AssetSize[]) {
  const jsNames = new Set(assets.filter((a) => a.name.endsWith(".js")).map((a) => a.name));
  const graph = new Map<string, string[]>();
  for (const name of jsNames) {
    const source = readFileSync(path.join(assetsDir, name), "utf8");
    graph.set(name, [...staticImports(source)].filter((dep) => jsNames.has(dep)));
  }
  const paint = closure(assets, paintRootPatterns, paintLoaderPatterns, graph);
  const store = new Set([...closure(assets, storeRootPatterns, storeLoaderPatterns, graph)].filter((name) => !paint.has(name)));
  return { paint, store };
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

const classes = eagerAssetClasses(assets);
const eagerNames = new Set([...classes.paint, ...classes.store]);
const classBytes = (names: Set<string>) => assets.filter((asset) => names.has(asset.name)).reduce((sum, asset) => sum + asset.gzipBytes, 0);
const paintGzipBytes = classBytes(classes.paint);
const storeGzipBytes = classBytes(classes.store);
if (paintGzipBytes > paintGzipBudget) {
  failures.push(`paint-critical assets: ${formatBytes(paintGzipBytes)} gzip > ${formatBytes(paintGzipBudget)}`);
}
if (storeGzipBytes > storeGzipBudget) {
  failures.push(`store assets: ${formatBytes(storeGzipBytes)} gzip > ${formatBytes(storeGzipBudget)}`);
}
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
    `(eager ${formatBytes(eagerGzipBytes)} = paint ${formatBytes(paintGzipBytes)} + store ${formatBytes(storeGzipBytes)} / lazy ${formatBytes(lazyGzipBytes)})`,
);
for (const asset of assets) {
  const marker = classes.paint.has(asset.name) ? "paint" : classes.store.has(asset.name) ? "store" : "lazy ";
  console.log(`${marker} ${asset.name.padEnd(38)} raw ${formatBytes(asset.bytes).padStart(10)} gzip ${formatBytes(asset.gzipBytes).padStart(10)}`);
}

const images = readdirSync(assetsDir).filter((name) => imagePattern.test(name));
const imageBytes = images.reduce((sum, name) => {
  const bytes = statSync(path.join(assetsDir, name)).size;
  if (bytes > maxImageBytes) {
    failures.push(`image: ${name} ${formatBytes(bytes)} > ${formatBytes(maxImageBytes)}; regenerate it smaller with scripts/optimize-images.ts`);
  }
  return sum + bytes;
}, 0);
console.log(`page images: ${images.length} files, ${formatBytes(imageBytes)} (limit ${formatBytes(maxImageBytes)} each)`);

// Server functions: modules evaluated on a cold start (built by `bun run build`).
const functionsDir = path.resolve(import.meta.dir, "../.vercel-functions");
if (existsSync(path.join(functionsDir, "index.mjs"))) {
  failures.push(...serverBudgetFailures(functionsDir));
} else {
  console.log("Server function budgets skipped: .vercel-functions not built");
}

if (failures.length > 0) {
  console.error("\nBundle budget failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
