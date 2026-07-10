import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import pixelmatch from "pixelmatch";

type PngImage = {
  data: Buffer;
  height: number;
  width: number;
};

type PngConstructor = {
  new (options: { height: number; width: number }): PngImage;
  sync: {
    read(buffer: Buffer): PngImage;
    write(png: PngImage): Buffer;
  };
};

const { PNG } = createRequire(import.meta.url)("pngjs") as { PNG: PngConstructor };

const VIEWPORT_SUFFIXES = ["desktop", "mobile"] as const;
const DEFAULT_ROOT = path.join("test-results", "parity-journeys");
const DEFAULT_REVIEW_THRESHOLD = 0.02;

type ViewportName = typeof VIEWPORT_SUFFIXES[number];

type ScreenshotEntry = {
  checkpoint: string;
  file: string;
  key: string;
  viewport: ViewportName;
};

type DiffRow = {
  checkpoint: string;
  diffFile: string;
  diffRatio: number;
  heightDelta: number;
  legacyFile: string;
  legacyHeight: number;
  legacyWidth: number;
  mismatchedPixels: number;
  totalPixels: number;
  viewport: ViewportName;
  viteFile: string;
  viteHeight: number;
  viteWidth: number;
};

type Options = {
  legacyDir: string;
  outDir: string;
  reviewThreshold: number;
  viteDir: string;
};

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseThreshold(value: string | undefined) {
  if (!value) return DEFAULT_REVIEW_THRESHOLD;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_REVIEW_THRESHOLD;
  return parsed > 1 ? parsed / 100 : parsed;
}

function options(): Options {
  const root = process.env.PARITY_JOURNEY_ROOT_DIR || DEFAULT_ROOT;
  return {
    legacyDir:
      argValue("--legacy") ||
      process.env.PARITY_JOURNEY_LEGACY_DIR ||
      path.join(root, "legacy"),
    viteDir:
      argValue("--vite") ||
      process.env.PARITY_JOURNEY_VITE_DIR ||
      path.join(root, "vite"),
    outDir:
      argValue("--out") ||
      process.env.PARITY_JOURNEY_DIFF_DIR ||
      path.join(root, "diff"),
    reviewThreshold: parseThreshold(
      argValue("--threshold") || process.env.PARITY_JOURNEY_REVIEW_THRESHOLD,
    ),
  };
}

function parseScreenshotFilename(filename: string): Omit<ScreenshotEntry, "file"> | null {
  if (!filename.endsWith(".png") || filename.endsWith("-DIFF.png")) return null;
  const base = filename.slice(0, -".png".length);
  for (const viewport of VIEWPORT_SUFFIXES) {
    const suffix = `-${viewport}`;
    if (!base.endsWith(suffix)) continue;
    const checkpoint = base.slice(0, -suffix.length);
    if (!checkpoint) return null;
    return {
      checkpoint,
      key: `${checkpoint}|${viewport}`,
      viewport,
    };
  }
  return null;
}

async function collectScreenshots(dir: string) {
  const entries = new Map<string, ScreenshotEntry>();
  for (const filename of await readdir(dir)) {
    const parsed = parseScreenshotFilename(filename);
    if (!parsed) continue;
    entries.set(parsed.key, {
      ...parsed,
      file: path.join(dir, filename),
    });
  }
  return entries;
}

function sortedKeys(values: Iterable<string>) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function cropPng(source: PngImage, width: number, height: number) {
  const cropped = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * source.width * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = y * width * 4;
    source.data.copy(cropped.data, targetStart, sourceStart, sourceEnd);
  }
  return cropped;
}

async function diffPair(
  legacy: ScreenshotEntry,
  vite: ScreenshotEntry,
  outDir: string,
): Promise<DiffRow> {
  const legacyPng = PNG.sync.read(await readFile(legacy.file));
  const vitePng = PNG.sync.read(await readFile(vite.file));
  const width = Math.min(legacyPng.width, vitePng.width);
  const height = Math.min(legacyPng.height, vitePng.height);
  if (width <= 0 || height <= 0) {
    throw new Error(`Cannot diff ${legacy.key}: common image area is empty`);
  }

  const legacyCrop = cropPng(legacyPng, width, height);
  const viteCrop = cropPng(vitePng, width, height);
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    legacyCrop.data,
    viteCrop.data,
    diff.data,
    width,
    height,
    { includeAA: false, threshold: 0.15 },
  );
  const diffFile = path.join(outDir, `${legacy.checkpoint}-${legacy.viewport}-DIFF.png`);
  await writeFile(diffFile, PNG.sync.write(diff));

  return {
    checkpoint: legacy.checkpoint,
    diffFile,
    diffRatio: mismatchedPixels / (width * height),
    heightDelta: vitePng.height - legacyPng.height,
    legacyFile: legacy.file,
    legacyHeight: legacyPng.height,
    legacyWidth: legacyPng.width,
    mismatchedPixels,
    totalPixels: width * height,
    viewport: legacy.viewport,
    viteFile: vite.file,
    viteHeight: vitePng.height,
    viteWidth: vitePng.width,
  };
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function markdownLink(outDir: string, file: string, label: string) {
  return `[${label}](${relativeLink(outDir, file)})`;
}

function relativeLink(outDir: string, file: string) {
  return path.relative(outDir, file).replaceAll(path.sep, "/");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMarkdown(
  rows: DiffRow[],
  missingLegacy: ScreenshotEntry[],
  missingVite: ScreenshotEntry[],
  opts: Options,
) {
  const aboveThreshold = rows.filter((row) => row.diffRatio > opts.reviewThreshold);
  return [
    "# Visual Journey Diff Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Legacy dir: \`${opts.legacyDir}\``,
    `Vite dir: \`${opts.viteDir}\``,
    "",
    "## Summary",
    "",
    `- Paired checkpoints: ${rows.length}`,
    `- Above review threshold (${formatPercent(opts.reviewThreshold)}): ${aboveThreshold.length}`,
    `- Missing legacy captures: ${missingLegacy.length}`,
    `- Missing vite captures: ${missingVite.length}`,
    "",
    "| checkpoint | viewport | diff% | height delta | legacy | vite | diff |",
    "| --- | --- | ---: | ---: | --- | --- | --- |",
    ...rows.map((row) =>
      [
        `\`${row.checkpoint}\``,
        row.viewport,
        formatPercent(row.diffRatio),
        `${row.heightDelta}px`,
        markdownLink(opts.outDir, row.legacyFile, "legacy"),
        markdownLink(opts.outDir, row.viteFile, "vite"),
        markdownLink(opts.outDir, row.diffFile, "diff"),
      ].join(" | "),
    ).map((line) => `| ${line} |`),
    "",
    ...(missingLegacy.length
      ? [
          "## Missing Legacy Captures",
          "",
          ...missingLegacy.map((entry) => `- \`${entry.checkpoint}\` ${entry.viewport}`),
          "",
        ]
      : []),
    ...(missingVite.length
      ? [
          "## Missing Vite Captures",
          "",
          ...missingVite.map((entry) => `- \`${entry.checkpoint}\` ${entry.viewport}`),
          "",
        ]
      : []),
  ].join("\n");
}

function renderHtml(
  rows: DiffRow[],
  missingLegacy: ScreenshotEntry[],
  missingVite: ScreenshotEntry[],
  opts: Options,
) {
  const aboveThreshold = rows.filter((row) => row.diffRatio > opts.reviewThreshold);
  const tableRows = rows.map((row) => `
        <tr>
          <td><code>${escapeHtml(row.checkpoint)}</code></td>
          <td>${escapeHtml(row.viewport)}</td>
          <td class="numeric">${formatPercent(row.diffRatio)}</td>
          <td class="numeric">${row.heightDelta}px</td>
          <td><a href="${escapeHtml(relativeLink(opts.outDir, row.legacyFile))}"><img src="${escapeHtml(relativeLink(opts.outDir, row.legacyFile))}" alt="legacy ${escapeHtml(row.checkpoint)} ${row.viewport}" /></a></td>
          <td><a href="${escapeHtml(relativeLink(opts.outDir, row.viteFile))}"><img src="${escapeHtml(relativeLink(opts.outDir, row.viteFile))}" alt="vite ${escapeHtml(row.checkpoint)} ${row.viewport}" /></a></td>
          <td><a href="${escapeHtml(relativeLink(opts.outDir, row.diffFile))}"><img src="${escapeHtml(relativeLink(opts.outDir, row.diffFile))}" alt="diff ${escapeHtml(row.checkpoint)} ${row.viewport}" /></a></td>
        </tr>`).join("\n");
  const missing = [...missingLegacy.map((entry) => `legacy: ${entry.checkpoint} ${entry.viewport}`), ...missingVite.map((entry) => `vite: ${entry.checkpoint} ${entry.viewport}`)];

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Visual Journey Diff Report</title>
    <style>
      body { color: #1f2937; font-family: system-ui, sans-serif; margin: 24px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-top: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
      th { background: #f9fafb; position: sticky; top: 0; }
      img { border: 1px solid #d1d5db; display: block; max-width: 220px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .numeric { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
      .summary { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0 24px; }
      .summary div { background: #f3f4f6; border-radius: 6px; padding: 10px 12px; }
    </style>
  </head>
  <body>
    <h1>Visual Journey Diff Report</h1>
    <p>Legacy dir: <code>${escapeHtml(opts.legacyDir)}</code></p>
    <p>Vite dir: <code>${escapeHtml(opts.viteDir)}</code></p>
    <div class="summary">
      <div>Paired checkpoints: <strong>${rows.length}</strong></div>
      <div>Above ${formatPercent(opts.reviewThreshold)}: <strong>${aboveThreshold.length}</strong></div>
      <div>Missing legacy: <strong>${missingLegacy.length}</strong></div>
      <div>Missing vite: <strong>${missingVite.length}</strong></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>checkpoint</th>
          <th>viewport</th>
          <th>diff%</th>
          <th>height delta</th>
          <th>legacy</th>
          <th>vite</th>
          <th>diff</th>
        </tr>
      </thead>
      <tbody>
${tableRows}
      </tbody>
    </table>
    ${missing.length ? `<h2>Missing captures</h2><ul>${missing.map((entry) => `<li><code>${escapeHtml(entry)}</code></li>`).join("")}</ul>` : ""}
  </body>
</html>`;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: bun scripts/parity/journey-diff.ts [--legacy dir] [--vite dir] [--out dir] [--threshold 0.02]",
    );
    return;
  }

  const opts = options();
  await mkdir(opts.outDir, { recursive: true });

  const [legacy, vite] = await Promise.all([
    collectScreenshots(opts.legacyDir),
    collectScreenshots(opts.viteDir),
  ]);
  const legacyKeys = new Set(legacy.keys());
  const viteKeys = new Set(vite.keys());
  const pairedKeys = sortedKeys([...legacyKeys].filter((key) => viteKeys.has(key)));
  const missingLegacy = sortedKeys([...viteKeys].filter((key) => !legacyKeys.has(key))).map((key) => vite.get(key)!);
  const missingVite = sortedKeys([...legacyKeys].filter((key) => !viteKeys.has(key))).map((key) => legacy.get(key)!);

  const rows: DiffRow[] = [];
  for (const key of pairedKeys) {
    rows.push(await diffPair(legacy.get(key)!, vite.get(key)!, opts.outDir));
  }
  rows.sort((a, b) => b.diffRatio - a.diffRatio || a.checkpoint.localeCompare(b.checkpoint));

  await writeFile(
    path.join(opts.outDir, "report.md"),
    renderMarkdown(rows, missingLegacy, missingVite, opts),
  );
  await writeFile(
    path.join(opts.outDir, "report.html"),
    renderHtml(rows, missingLegacy, missingVite, opts),
  );

  console.log(`Wrote ${path.join(opts.outDir, "report.md")}`);
  console.log(`Wrote ${path.join(opts.outDir, "report.html")}`);
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main().catch((error) => {
    console.error("Visual journey diff failed. This harness is report-only and exits 0.");
    console.error(error);
  });
}
