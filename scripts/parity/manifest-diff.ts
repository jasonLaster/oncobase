import { writeFile } from "node:fs/promises";

const DEFAULT_LEGACY_ORIGIN = "https://diana-tnbc.com";

export type ManifestPage = {
  slug: string;
  contentHash: string | null;
  size: number;
};

export type ManifestAsset = {
  kind: "pdf" | "file";
  path: string;
  contentHash: string | null;
  size: number | null;
};

export type WikiManifest = {
  manifestHash: string;
  scope: "public" | "session";
  compactTree: unknown;
  pages: ManifestPage[];
  assets: ManifestAsset[];
};

export type ManifestDiff = {
  manifestHashEqual: boolean;
  counts: {
    leftPages: number;
    rightPages: number;
    leftAssets: number;
    rightAssets: number;
  };
  missingPages: string[];
  extraPages: string[];
  changedPages: Array<{
    slug: string;
    leftContentHash: string | null;
    rightContentHash: string | null;
    leftSize: number;
    rightSize: number;
  }>;
  missingAssets: string[];
  extraAssets: string[];
  changedAssets: Array<{
    key: string;
    leftContentHash: string | null;
    rightContentHash: string | null;
    leftSize: number | null;
    rightSize: number | null;
  }>;
  compactTreeEqual: boolean;
};

type NamedManifest = {
  label: string;
  origin: string;
  manifest: WikiManifest;
};

function sorted<T>(values: Iterable<T>, toString = (value: T) => String(value)) {
  return [...values].sort((a, b) => toString(a).localeCompare(toString(b)));
}

function assetKey(asset: ManifestAsset) {
  return `${asset.kind}:${asset.path}`;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

export function diffManifests(left: WikiManifest, right: WikiManifest): ManifestDiff {
  const leftPages = new Map(left.pages.map((page) => [page.slug, page]));
  const rightPages = new Map(right.pages.map((page) => [page.slug, page]));
  const pageSlugs = new Set([...leftPages.keys(), ...rightPages.keys()]);

  const missingPages: string[] = [];
  const extraPages: string[] = [];
  const changedPages: ManifestDiff["changedPages"] = [];

  for (const slug of sorted(pageSlugs)) {
    const leftPage = leftPages.get(slug);
    const rightPage = rightPages.get(slug);
    if (!leftPage) {
      extraPages.push(slug);
      continue;
    }
    if (!rightPage) {
      missingPages.push(slug);
      continue;
    }
    if (
      leftPage.contentHash !== rightPage.contentHash ||
      leftPage.size !== rightPage.size
    ) {
      changedPages.push({
        slug,
        leftContentHash: leftPage.contentHash,
        rightContentHash: rightPage.contentHash,
        leftSize: leftPage.size,
        rightSize: rightPage.size,
      });
    }
  }

  const leftAssets = new Map(left.assets.map((asset) => [assetKey(asset), asset]));
  const rightAssets = new Map(right.assets.map((asset) => [assetKey(asset), asset]));
  const assetKeys = new Set([...leftAssets.keys(), ...rightAssets.keys()]);
  const missingAssets: string[] = [];
  const extraAssets: string[] = [];
  const changedAssets: ManifestDiff["changedAssets"] = [];

  for (const key of sorted(assetKeys)) {
    const leftAsset = leftAssets.get(key);
    const rightAsset = rightAssets.get(key);
    if (!leftAsset) {
      extraAssets.push(key);
      continue;
    }
    if (!rightAsset) {
      missingAssets.push(key);
      continue;
    }
    if (
      leftAsset.contentHash !== rightAsset.contentHash ||
      leftAsset.size !== rightAsset.size
    ) {
      changedAssets.push({
        key,
        leftContentHash: leftAsset.contentHash,
        rightContentHash: rightAsset.contentHash,
        leftSize: leftAsset.size,
        rightSize: rightAsset.size,
      });
    }
  }

  return {
    manifestHashEqual: left.manifestHash === right.manifestHash,
    counts: {
      leftPages: left.pages.length,
      rightPages: right.pages.length,
      leftAssets: left.assets.length,
      rightAssets: right.assets.length,
    },
    missingPages,
    extraPages,
    changedPages,
    missingAssets,
    extraAssets,
    changedAssets,
    compactTreeEqual: stableJson(left.compactTree) === stableJson(right.compactTree),
  };
}

function linesForList(title: string, values: string[], limit = 50) {
  if (values.length === 0) return [`### ${title}`, "", "None.", ""];
  return [
    `### ${title} (${values.length})`,
    "",
    ...values.slice(0, limit).map((value) => `- \`${value}\``),
    ...(values.length > limit ? [`- ... ${values.length - limit} more`] : []),
    "",
  ];
}

function linesForPageChanges(changes: ManifestDiff["changedPages"], limit = 50) {
  if (changes.length === 0) return ["### Changed Pages", "", "None.", ""];
  return [
    `### Changed Pages (${changes.length})`,
    "",
    "| Slug | Content Hash | Size |",
    "| --- | --- | --- |",
    ...changes.slice(0, limit).map((change) =>
      `| \`${change.slug}\` | \`${change.leftContentHash ?? "null"}\` -> \`${change.rightContentHash ?? "null"}\` | ${change.leftSize} -> ${change.rightSize} |`,
    ),
    ...(changes.length > limit
      ? [`| ... | ${changes.length - limit} more | |`]
      : []),
    "",
  ];
}

function linesForAssetChanges(changes: ManifestDiff["changedAssets"], limit = 50) {
  if (changes.length === 0) return ["### Changed Assets", "", "None.", ""];
  return [
    `### Changed Assets (${changes.length})`,
    "",
    "| Asset | Content Hash | Size |",
    "| --- | --- | --- |",
    ...changes.slice(0, limit).map((change) =>
      `| \`${change.key}\` | \`${change.leftContentHash ?? "null"}\` -> \`${change.rightContentHash ?? "null"}\` | ${change.leftSize ?? "null"} -> ${change.rightSize ?? "null"} |`,
    ),
    ...(changes.length > limit
      ? [`| ... | ${changes.length - limit} more | |`]
      : []),
    "",
  ];
}

export function renderManifestDiffMarkdown(
  left: NamedManifest,
  right: NamedManifest,
  diff: ManifestDiff,
) {
  return [
    "# Wiki Manifest Parity Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Side | Origin | Scope | Manifest Hash | Pages | Assets |",
    "| --- | --- | --- | --- | ---: | ---: |",
    `| ${left.label} | ${left.origin} | ${left.manifest.scope} | \`${left.manifest.manifestHash}\` | ${left.manifest.pages.length} | ${left.manifest.assets.length} |`,
    `| ${right.label} | ${right.origin} | ${right.manifest.scope} | \`${right.manifest.manifestHash}\` | ${right.manifest.pages.length} | ${right.manifest.assets.length} |`,
    "",
    "## Summary",
    "",
    `- Manifest hash match: **${diff.manifestHashEqual ? "yes" : "no"}**`,
    `- Compact tree match: **${diff.compactTreeEqual ? "yes" : "no"}**`,
    `- Missing pages on ${right.label}: ${diff.missingPages.length}`,
    `- Extra pages on ${right.label}: ${diff.extraPages.length}`,
    `- Changed pages: ${diff.changedPages.length}`,
    `- Missing assets on ${right.label}: ${diff.missingAssets.length}`,
    `- Extra assets on ${right.label}: ${diff.extraAssets.length}`,
    `- Changed assets: ${diff.changedAssets.length}`,
    "",
    ...linesForList(`Pages missing on ${right.label}`, diff.missingPages),
    ...linesForList(`Pages extra on ${right.label}`, diff.extraPages),
    ...linesForPageChanges(diff.changedPages),
    ...linesForList(`Assets missing on ${right.label}`, diff.missingAssets),
    ...linesForList(`Assets extra on ${right.label}`, diff.extraAssets),
    ...linesForAssetChanges(diff.changedAssets),
  ].join("\n");
}

function cookieFor(label: "legacy" | "vite") {
  const specific =
    label === "legacy"
      ? process.env.PARITY_LEGACY_COOKIE_HEADER
      : process.env.PARITY_VITE_COOKIE_HEADER;
  return specific || process.env.PARITY_COOKIE_HEADER || "";
}

export async function fetchManifest(origin: string, options: {
  scope?: "public" | "session";
  cookieHeader?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<WikiManifest> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL("/api/wiki/manifest", origin);
  if (options.scope === "session") url.searchParams.set("scope", "session");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.cookieHeader) headers.Cookie = options.cookieHeader;

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`Manifest fetch failed for ${url}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as WikiManifest;
}

async function buildReport(viteOrigin: string, scope: "public" | "session") {
  const legacyOrigin = process.env.PARITY_LEGACY_ORIGIN || DEFAULT_LEGACY_ORIGIN;
  const [legacy, vite] = await Promise.all([
    fetchManifest(legacyOrigin, {
      scope,
      cookieHeader: scope === "session" ? cookieFor("legacy") : "",
    }),
    fetchManifest(viteOrigin, {
      scope,
      cookieHeader: scope === "session" ? cookieFor("vite") : "",
    }),
  ]);

  const left = { label: "legacy", origin: legacyOrigin, manifest: legacy };
  const right = { label: "vite", origin: viteOrigin, manifest: vite };
  return renderManifestDiffMarkdown(left, right, diffManifests(legacy, vite));
}

async function main() {
  const viteOrigin = process.argv[2];
  if (!viteOrigin) {
    console.error("Usage: bun scripts/parity/manifest-diff.ts <vite-origin> [--session] [--out report.md]");
    process.exitCode = 0;
    return;
  }

  const scope = process.argv.includes("--session") ? "session" : "public";
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "";

  try {
    const markdown = await buildReport(viteOrigin, scope);
    if (outPath) {
      await writeFile(outPath, markdown);
      console.log(`Wrote ${outPath}`);
    } else {
      console.log(markdown);
    }
  } catch (error) {
    console.error("# Wiki Manifest Parity Report\n");
    console.error("Report generation failed. This harness is report-only and exits 0.");
    console.error(error);
  }
}

if (import.meta.main) {
  await main();
}
