import { promises as fs } from "fs";
import path from "path";
import { parseDicom } from "dicom-parser";

const DICOM_EXTENSIONS = new Set([".dcm", ".dicom", ".ima"]);
const SKIPPED_DIRECTORIES = new Set([".git", ".next", "node_modules"]);

export interface LocalDicomImage {
  id: string;
  fileName: string;
  relativePath: string;
  byteLength: number;
  modifiedAt: string;
  imageId: string;
  instanceNumber: number | null;
  imagePosition: number | null;
  rows: number | null;
  columns: number | null;
}

export interface LocalDicomSeries {
  id: string;
  seriesKey: string;
  label: string;
  root: string;
  directory: string;
  relativeDirectory: string;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  studyDate: string | null;
  seriesNumber: number | null;
  images: LocalDicomImage[];
}

export interface LocalDicomCatalog {
  root: string | null;
  rootsTried: string[];
  series: LocalDicomSeries[];
}

interface ParsedDicom {
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  studyDate: string | null;
  seriesNumber: number | null;
  instanceNumber: number | null;
  imagePosition: number | null;
  rows: number | null;
  columns: number | null;
}

interface CandidateFile {
  absolutePath: string;
  relativePath: string;
  stats: Awaited<ReturnType<typeof fs.stat>>;
}

export async function getDicomCatalog(): Promise<LocalDicomCatalog> {
  const rootsTried = getDiagnosticsRootCandidates();
  const root = await findFirstDirectory(rootsTried);

  if (!root) {
    return { root: null, rootsTried, series: [] };
  }

  const files = await listDicomFiles(root);
  const groups = new Map<string, LocalDicomSeries>();

  for (const file of files) {
    const parsed = await parseDicomMetadata(file.absolutePath);
    const directory = path.dirname(file.absolutePath);
    const relativeDirectory = normalizePath(path.relative(root, directory)) || ".";
    const seriesKey =
      parsed?.seriesInstanceUid ??
      `${parsed?.studyInstanceUid ?? "study"}:${relativeDirectory}`;

    const existing = groups.get(seriesKey);
    const image: LocalDicomImage = {
      id: encodePath(file.relativePath),
      fileName: path.basename(file.absolutePath),
      relativePath: file.relativePath,
      byteLength: Number(file.stats.size),
      modifiedAt: file.stats.mtime.toISOString(),
      imageId: `/api/dicom/file?path=${encodeURIComponent(file.relativePath)}`,
      instanceNumber: parsed?.instanceNumber ?? null,
      imagePosition: parsed?.imagePosition ?? null,
      rows: parsed?.rows ?? null,
      columns: parsed?.columns ?? null,
    };

    if (existing) {
      existing.images.push(image);
      continue;
    }

    const fallbackLabel = relativeDirectory === "." ? "Diagnostics root" : relativeDirectory;
    groups.set(seriesKey, {
      id: encodePath(seriesKey),
      seriesKey,
      label: buildSeriesLabel(parsed, fallbackLabel),
      root,
      directory,
      relativeDirectory,
      modality: parsed?.modality ?? null,
      studyDescription: parsed?.studyDescription ?? null,
      seriesDescription: parsed?.seriesDescription ?? null,
      studyDate: parsed?.studyDate ?? null,
      seriesNumber: parsed?.seriesNumber ?? null,
      images: [image],
    });
  }

  const series = [...groups.values()]
    .map((group) => ({
      ...group,
      images: group.images.sort(compareImages),
    }))
    .sort(compareSeries);

  return { root, rootsTried, series };
}

export async function resolveDicomPath(relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;

  const root = await findFirstDirectory(getDiagnosticsRootCandidates());
  if (!root) return null;

  const absolutePath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (!DICOM_EXTENSIONS.has(ext)) return null;

  return { root, absolutePath };
}

function getDiagnosticsRootCandidates() {
  const envRoots = [
    process.env.ONCOBASE_DICOM_ROOT,
    process.env.DIANA_DIAGNOSTICS_PATH,
    process.env.DICOM_VIEWER_ROOT,
  ]
    .flatMap((value) => (value ? value.split(":") : []))
    .map((value) => value.trim())
    .filter(Boolean);

  const cwd = process.cwd();
  return unique([
    ...envRoots,
    path.resolve(cwd, "../diana-tnbc/diagnostics"),
    path.resolve(cwd, "../../..", "diana-tnbc/diagnostics"),
    path.resolve(cwd, "../../../..", "diana-tnbc/diagnostics"),
  ]);
}

async function findFirstDirectory(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {
      // Candidate roots are intentionally best-effort across local worktrees.
    }
  }
  return null;
}

async function listDicomFiles(root: string) {
  const files: CandidateFile[] = [];

  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!DICOM_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      const stats = await fs.stat(absolutePath);
      files.push({
        absolutePath,
        relativePath: normalizePath(path.relative(root, absolutePath)),
        stats,
      });
    }
  }

  await walk(root);
  return files;
}

async function parseDicomMetadata(absolutePath: string): Promise<ParsedDicom | null> {
  try {
    const buffer = await fs.readFile(absolutePath);
    const dataSet = parseDicom(new Uint8Array(buffer), {
      untilTag: "x7fe00010",
    });

    return {
      studyInstanceUid: cleanText(dataSet.string("x0020000d")),
      seriesInstanceUid: cleanText(dataSet.string("x0020000e")),
      modality: cleanText(dataSet.string("x00080060")),
      studyDescription: cleanText(dataSet.string("x00081030")),
      seriesDescription: cleanText(dataSet.string("x0008103e")),
      studyDate: formatDicomDate(cleanText(dataSet.string("x00080020"))),
      seriesNumber: numberValue(dataSet.string("x00200011")),
      instanceNumber: numberValue(dataSet.string("x00200013")),
      imagePosition: parseImagePosition(cleanText(dataSet.string("x00200032"))),
      rows: dataSet.uint16("x00280010") ?? null,
      columns: dataSet.uint16("x00280011") ?? null,
    };
  } catch {
    return null;
  }
}

function buildSeriesLabel(parsed: ParsedDicom | null, fallback: string) {
  const parts = [
    parsed?.studyDate,
    parsed?.modality,
    parsed?.seriesDescription ?? parsed?.studyDescription,
    parsed?.seriesNumber ? `Series ${parsed.seriesNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : fallback;
}

function compareSeries(a: LocalDicomSeries, b: LocalDicomSeries) {
  return (
    (b.studyDate ?? "").localeCompare(a.studyDate ?? "") ||
    (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) -
      (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
    a.relativeDirectory.localeCompare(b.relativeDirectory)
  );
}

function compareImages(a: LocalDicomImage, b: LocalDicomImage) {
  if (a.imagePosition !== null && b.imagePosition !== null) {
    return a.imagePosition - b.imagePosition;
  }
  if (a.instanceNumber !== null && b.instanceNumber !== null) {
    return a.instanceNumber - b.instanceNumber;
  }
  return a.relativePath.localeCompare(b.relativePath, undefined, {
    numeric: true,
  });
}

function parseImagePosition(value: string | null) {
  if (!value) return null;
  const parts = value.split("\\").map(Number);
  const z = parts[2];
  return Number.isFinite(z) ? z : null;
}

function numberValue(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string | undefined) {
  const clean = value?.replace(/\0/g, "").trim();
  return clean || null;
}

function formatDicomDate(value: string | null) {
  if (!value || !/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizePath(value: string) {
  return value.split(path.sep).join("/");
}

function encodePath(value: string) {
  return Buffer.from(value).toString("base64url");
}

function unique(values: string[]) {
  return [...new Set(values)];
}
