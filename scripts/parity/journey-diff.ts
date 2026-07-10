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
const DEFAULT_LOCALIZED_CLUSTER_FLOOR = 2_500;
const MAX_TOKEN_EXAMPLES = 8;

type ViewportName = typeof VIEWPORT_SUFFIXES[number];

type ScreenshotEntry = {
  checkpoint: string;
  file: string;
  key: string;
  viewport: ViewportName;
};

type ClusterBounds = {
  h: number;
  w: number;
  x: number;
  y: number;
};

type TextDiff = {
  addedExamples: string[];
  removedExamples: string[];
  tokensAdded: number;
  tokensRemoved: number;
};

type DiffRow = {
  clusterCount: number;
  checkpoint: string;
  diffFile: string;
  diffRatio: number;
  heightDelta: number;
  legacyFile: string;
  legacyHeight: number;
  legacyWidth: number;
  localized: boolean;
  maxClusterBounds: ClusterBounds | null;
  maxClusterPx: number;
  mismatchedPixels: number;
  textDiff: TextDiff | null;
  totalPixels: number;
  viewport: ViewportName;
  viteFile: string;
  viteHeight: number;
  viteWidth: number;
};

type Options = {
  legacyDir: string;
  localizedClusterFloor: number;
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

function parsePixelFloor(value: string | undefined) {
  if (!value) return DEFAULT_LOCALIZED_CLUSTER_FLOOR;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LOCALIZED_CLUSTER_FLOOR;
  return Math.floor(parsed);
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
    localizedClusterFloor: parsePixelFloor(
      argValue("--localized-floor") || process.env.PARITY_JOURNEY_LOCALIZED_CLUSTER_FLOOR,
    ),
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

function textFileForEntry(entry: ScreenshotEntry) {
  return path.join(path.dirname(entry.file), `${entry.checkpoint}-${entry.viewport}.txt`);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

async function readTextSidecar(entry: ScreenshotEntry) {
  try {
    return normalizeText(await readFile(textFileForEntry(entry), "utf8"));
  } catch {
    return null;
  }
}

function tokenize(text: string) {
  return text ? text.split(/\s+/).filter(Boolean) : [];
}

function diffTokens(legacyText: string, viteText: string): TextDiff {
  const legacyTokens = tokenize(legacyText);
  const viteTokens = tokenize(viteText);
  const legacyRemaining = new Map<string, number>();
  const viteRemaining = new Map<string, number>();

  for (const token of legacyTokens) {
    legacyRemaining.set(token, (legacyRemaining.get(token) ?? 0) + 1);
  }
  for (const token of viteTokens) {
    viteRemaining.set(token, (viteRemaining.get(token) ?? 0) + 1);
  }

  const addedExamples: string[] = [];
  const removedExamples: string[] = [];
  let tokensAdded = 0;
  let tokensRemoved = 0;

  for (const token of viteTokens) {
    const remaining = legacyRemaining.get(token) ?? 0;
    if (remaining > 0) {
      legacyRemaining.set(token, remaining - 1);
      continue;
    }
    tokensAdded += 1;
    if (addedExamples.length < MAX_TOKEN_EXAMPLES) addedExamples.push(token);
  }

  for (const token of legacyTokens) {
    const remaining = viteRemaining.get(token) ?? 0;
    if (remaining > 0) {
      viteRemaining.set(token, remaining - 1);
      continue;
    }
    tokensRemoved += 1;
    if (removedExamples.length < MAX_TOKEN_EXAMPLES) removedExamples.push(token);
  }

  return {
    addedExamples,
    removedExamples,
    tokensAdded,
    tokensRemoved,
  };
}

function isDiffPixel(data: Buffer, pixelIndex: number) {
  const offset = pixelIndex * 4;
  return data[offset] === 255 && data[offset + 1] === 0 && data[offset + 2] === 0 && data[offset + 3] === 255;
}

function measureDiffClusters(data: Buffer, width: number, height: number) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const stack = new Int32Array(totalPixels);
  let clusterCount = 0;
  let maxClusterBounds: ClusterBounds | null = null;
  let maxClusterPx = 0;

  for (let index = 0; index < totalPixels; index += 1) {
    if (visited[index] || !isDiffPixel(data, index)) continue;

    clusterCount += 1;
    let stackSize = 1;
    let clusterPx = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    visited[index] = 1;
    stack[0] = index;

    while (stackSize > 0) {
      const current = stack[--stackSize];
      const x = current % width;
      const y = Math.floor(current / width);

      clusterPx += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const next = current - 1;
        if (!visited[next] && isDiffPixel(data, next)) {
          visited[next] = 1;
          stack[stackSize++] = next;
        }
      }
      if (x + 1 < width) {
        const next = current + 1;
        if (!visited[next] && isDiffPixel(data, next)) {
          visited[next] = 1;
          stack[stackSize++] = next;
        }
      }
      if (y > 0) {
        const next = current - width;
        if (!visited[next] && isDiffPixel(data, next)) {
          visited[next] = 1;
          stack[stackSize++] = next;
        }
      }
      if (y + 1 < height) {
        const next = current + width;
        if (!visited[next] && isDiffPixel(data, next)) {
          visited[next] = 1;
          stack[stackSize++] = next;
        }
      }
    }

    if (clusterPx > maxClusterPx) {
      maxClusterPx = clusterPx;
      maxClusterBounds = {
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
      };
    }
  }

  return { clusterCount, maxClusterBounds, maxClusterPx };
}

async function diffPair(
  legacy: ScreenshotEntry,
  vite: ScreenshotEntry,
  opts: Options,
): Promise<DiffRow> {
  const [legacyImage, viteImage, legacyText, viteText] = await Promise.all([
    readFile(legacy.file),
    readFile(vite.file),
    readTextSidecar(legacy),
    readTextSidecar(vite),
  ]);
  const legacyPng = PNG.sync.read(legacyImage);
  const vitePng = PNG.sync.read(viteImage);
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
    { diffColor: [255, 0, 0], diffColorAlt: [255, 0, 0], includeAA: false, threshold: 0.15 },
  );
  const clusterMetrics = measureDiffClusters(diff.data, width, height);
  const textDiff = legacyText !== null && viteText !== null ? diffTokens(legacyText, viteText) : null;
  const diffFile = path.join(opts.outDir, `${legacy.checkpoint}-${legacy.viewport}-DIFF.png`);
  await writeFile(diffFile, PNG.sync.write(diff));

  return {
    clusterCount: clusterMetrics.clusterCount,
    checkpoint: legacy.checkpoint,
    diffFile,
    diffRatio: mismatchedPixels / (width * height),
    heightDelta: vitePng.height - legacyPng.height,
    legacyFile: legacy.file,
    legacyHeight: legacyPng.height,
    legacyWidth: legacyPng.width,
    localized: clusterMetrics.maxClusterPx > 0 && clusterMetrics.maxClusterPx >= opts.localizedClusterFloor,
    maxClusterBounds: clusterMetrics.maxClusterBounds,
    maxClusterPx: clusterMetrics.maxClusterPx,
    mismatchedPixels,
    textDiff,
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

function textDelta(row: DiffRow) {
  return row.textDiff ? row.textDiff.tokensAdded + row.textDiff.tokensRemoved : null;
}

function formatTextDelta(row: DiffRow) {
  const delta = textDelta(row);
  return row.textDiff === null ? "n/a" : `${delta} (+${row.textDiff.tokensAdded}/-${row.textDiff.tokensRemoved})`;
}

function formatBounds(bounds: ClusterBounds | null) {
  return bounds ? `${bounds.x},${bounds.y},${bounds.w},${bounds.h}` : "n/a";
}

function rowFlags(row: DiffRow) {
  const flags: string[] = [];
  if ((textDelta(row) ?? 0) > 0) flags.push("semantic");
  if (row.localized) flags.push("localized");
  return flags;
}

function flaggedBelowThresholdRows(rows: DiffRow[], opts: Options) {
  return rows.filter((row) => row.diffRatio <= opts.reviewThreshold && rowFlags(row).length > 0);
}

function renderMarkdownRows(rows: DiffRow[], opts: Options, includeFlags: boolean) {
  if (!rows.length) return ["- None.", ""];

  const header = includeFlags
    ? "| checkpoint | viewport | flags | diff% | text Δ | clusters | max cluster | max bounds | height delta | legacy | vite | diff |"
    : "| checkpoint | viewport | diff% | text Δ | clusters | max cluster | max bounds | localized | height delta | legacy | vite | diff |";
  const alignment = includeFlags
    ? "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |"
    : "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | --- | --- |";

  return [
    header,
    alignment,
    ...rows
      .map((row) => {
        const cells = [
          `\`${row.checkpoint}\``,
          row.viewport,
          formatPercent(row.diffRatio),
          formatTextDelta(row),
          String(row.clusterCount),
          String(row.maxClusterPx),
          formatBounds(row.maxClusterBounds),
          `${row.heightDelta}px`,
          markdownLink(opts.outDir, row.legacyFile, "legacy"),
          markdownLink(opts.outDir, row.viteFile, "vite"),
          markdownLink(opts.outDir, row.diffFile, "diff"),
        ];
        if (includeFlags) {
          cells.splice(2, 0, rowFlags(row).join(", ") || "n/a");
        } else {
          cells.splice(7, 0, row.localized ? "yes" : "no");
        }
        return `| ${cells.join(" | ")} |`;
      }),
    "",
  ];
}

function renderMarkdown(
  rows: DiffRow[],
  missingLegacy: ScreenshotEntry[],
  missingVite: ScreenshotEntry[],
  opts: Options,
) {
  const aboveThreshold = rows.filter((row) => row.diffRatio > opts.reviewThreshold);
  const flaggedBelowThreshold = flaggedBelowThresholdRows(rows, opts);
  const textCompared = rows.filter((row) => row.textDiff !== null);
  const localizedRows = rows.filter((row) => row.localized);
  return [
    "# Visual Journey Diff Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Legacy dir: \`${opts.legacyDir}\``,
    `Vite dir: \`${opts.viteDir}\``,
    `Localized cluster floor: \`${opts.localizedClusterFloor}px\``,
    "",
    "## Semantic differences below pixel threshold",
    "",
    `Pairs below ${formatPercent(opts.reviewThreshold)} with semantic text drift or localized diff clusters.`,
    "",
    ...renderMarkdownRows(flaggedBelowThreshold, opts, true),
    "",
    "## Summary",
    "",
    `- Paired checkpoints: ${rows.length}`,
    `- Above review threshold (${formatPercent(opts.reviewThreshold)}): ${aboveThreshold.length}`,
    `- Semantic/localized below threshold: ${flaggedBelowThreshold.length}`,
    `- Pairs with text sidecars compared: ${textCompared.length}`,
    `- Localized cluster flags: ${localizedRows.length}`,
    `- Missing legacy captures: ${missingLegacy.length}`,
    `- Missing vite captures: ${missingVite.length}`,
    "",
    "## All Paired Checkpoints",
    "",
    ...renderMarkdownRows(rows, opts, false),
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

function renderTokenExamples(label: string, examples: string[]) {
  if (!examples.length) return "";
  return `<div><span class="token-label">${escapeHtml(label)}</span> ${examples
    .map((token) => `<code class="token">${escapeHtml(token)}</code>`)
    .join(" ")}</div>`;
}

function renderTextDeltaHtml(row: DiffRow) {
  const delta = textDelta(row);
  if (delta === null) return `<span class="muted">n/a</span>`;
  return `<div class="text-delta"><strong>${delta}</strong><div class="muted">+${row.textDiff?.tokensAdded ?? 0} / -${row.textDiff?.tokensRemoved ?? 0}</div>${renderTokenExamples("+", row.textDiff?.addedExamples ?? [])}${renderTokenExamples("-", row.textDiff?.removedExamples ?? [])}</div>`;
}

function renderFlagsHtml(row: DiffRow) {
  const flags = rowFlags(row);
  if (!flags.length) return `<span class="muted">n/a</span>`;
  return flags.map((flag) => `<span class="flag">${escapeHtml(flag)}</span>`).join(" ");
}

function renderImageLink(outDir: string, file: string, label: string, row: DiffRow) {
  const href = escapeHtml(relativeLink(outDir, file));
  const alt = `${label} ${row.checkpoint} ${row.viewport}`;
  return `<a href="${href}"><img src="${href}" alt="${escapeHtml(alt)}" /></a>`;
}

function renderHtmlRows(rows: DiffRow[], opts: Options, includeFlags: boolean) {
  if (!rows.length) return `<p class="muted">None.</p>`;
  const flagsHeader = includeFlags ? "<th>flags</th>" : "";
  const flagsCell = (row: DiffRow) => includeFlags ? `<td>${renderFlagsHtml(row)}</td>` : "";
  return `<table>
      <thead>
        <tr>
          <th>checkpoint</th>
          <th>viewport</th>
          ${flagsHeader}
          <th>diff%</th>
          <th>text Δ</th>
          <th>clusters</th>
          <th>max cluster</th>
          <th>max bounds</th>
          <th>localized</th>
          <th>height delta</th>
          <th>legacy</th>
          <th>vite</th>
          <th>diff</th>
        </tr>
      </thead>
      <tbody>
${rows.map((row) => `
        <tr>
          <td><code>${escapeHtml(row.checkpoint)}</code></td>
          <td>${escapeHtml(row.viewport)}</td>
          ${flagsCell(row)}
          <td class="numeric">${formatPercent(row.diffRatio)}</td>
          <td class="numeric">${renderTextDeltaHtml(row)}</td>
          <td class="numeric">${row.clusterCount}</td>
          <td class="numeric">${row.maxClusterPx}</td>
          <td><code>${escapeHtml(formatBounds(row.maxClusterBounds))}</code></td>
          <td>${row.localized ? "yes" : "no"}</td>
          <td class="numeric">${row.heightDelta}px</td>
          <td>${renderImageLink(opts.outDir, row.legacyFile, "legacy", row)}</td>
          <td>${renderImageLink(opts.outDir, row.viteFile, "vite", row)}</td>
          <td>${renderImageLink(opts.outDir, row.diffFile, "diff", row)}</td>
        </tr>`).join("\n")}
      </tbody>
    </table>`;
}

function renderHtml(
  rows: DiffRow[],
  missingLegacy: ScreenshotEntry[],
  missingVite: ScreenshotEntry[],
  opts: Options,
) {
  const aboveThreshold = rows.filter((row) => row.diffRatio > opts.reviewThreshold);
  const flaggedBelowThreshold = flaggedBelowThresholdRows(rows, opts);
  const textCompared = rows.filter((row) => row.textDiff !== null);
  const localizedRows = rows.filter((row) => row.localized);
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
      .muted { color: #6b7280; }
      .summary { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0 24px; }
      .summary div { background: #f3f4f6; border-radius: 6px; padding: 10px 12px; }
      .flag { background: #eef2ff; border-radius: 999px; color: #3730a3; display: inline-block; font-size: 12px; margin: 0 4px 4px 0; padding: 2px 7px; }
      .token { background: #f3f4f6; border-radius: 4px; display: inline-block; margin: 3px 2px 0 0; padding: 2px 4px; }
      .token-label { color: #6b7280; display: inline-block; font-size: 12px; font-weight: 700; min-width: 12px; }
      .text-delta { min-width: 120px; text-align: left; }
    </style>
  </head>
  <body>
    <h1>Visual Journey Diff Report</h1>
    <p>Legacy dir: <code>${escapeHtml(opts.legacyDir)}</code></p>
    <p>Vite dir: <code>${escapeHtml(opts.viteDir)}</code></p>
    <p>Localized cluster floor: <code>${opts.localizedClusterFloor}px</code></p>
    <div class="summary">
      <div>Paired checkpoints: <strong>${rows.length}</strong></div>
      <div>Above ${formatPercent(opts.reviewThreshold)}: <strong>${aboveThreshold.length}</strong></div>
      <div>Semantic/localized below threshold: <strong>${flaggedBelowThreshold.length}</strong></div>
      <div>Text sidecars compared: <strong>${textCompared.length}</strong></div>
      <div>Localized flags: <strong>${localizedRows.length}</strong></div>
      <div>Missing legacy: <strong>${missingLegacy.length}</strong></div>
      <div>Missing vite: <strong>${missingVite.length}</strong></div>
    </div>
    <h2>Semantic differences below pixel threshold</h2>
    <p>Pairs below ${formatPercent(opts.reviewThreshold)} with semantic text drift or localized diff clusters.</p>
    ${renderHtmlRows(flaggedBelowThreshold, opts, true)}
    <h2>All paired checkpoints</h2>
    ${renderHtmlRows(rows, opts, false)}
    ${missing.length ? `<h2>Missing captures</h2><ul>${missing.map((entry) => `<li><code>${escapeHtml(entry)}</code></li>`).join("")}</ul>` : ""}
  </body>
</html>`;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      [
        "Usage: bun scripts/parity/journey-diff.ts [--legacy dir] [--vite dir] [--out dir] [--threshold 0.02] [--localized-floor 2500]",
        "",
        "Environment overrides:",
        "  PARITY_JOURNEY_ROOT_DIR",
        "  PARITY_JOURNEY_LEGACY_DIR",
        "  PARITY_JOURNEY_VITE_DIR",
        "  PARITY_JOURNEY_DIFF_DIR",
        "  PARITY_JOURNEY_REVIEW_THRESHOLD",
        "  PARITY_JOURNEY_LOCALIZED_CLUSTER_FLOOR",
      ].join("\n"),
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
    rows.push(await diffPair(legacy.get(key)!, vite.get(key)!, opts));
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
