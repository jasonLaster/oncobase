import { promises as fs } from "fs";
import path from "path";

import { getDiagnosticsRootCandidates } from "@/lib/dicom-local";

export type DiagnosticReportKind = "pdf" | "image-html";

export interface DiagnosticReportAsset {
  label: string;
  path: string;
}

export interface DiagnosticReport {
  biopsyId: string;
  title: string;
  kind: DiagnosticReportKind;
  primaryPath?: string;
  htmlPath?: string;
  imageAssets?: DiagnosticReportAsset[];
}

export interface ResolvedDiagnosticReport {
  report: DiagnosticReport;
  root: string;
  absolutePath: string | null;
  absoluteHtmlPath: string | null;
  imageAssets: Array<DiagnosticReportAsset & { absolutePath: string }>;
}

const DIAGNOSTIC_REPORTS: DiagnosticReport[] = [
  {
    biopsyId: "biopsy-2026-04-10",
    title: "April 10 biopsy original report",
    kind: "image-html",
    htmlPath: "4-10 biopsy/LASTERDIANAD (1)/SER00002/UNWRAP/report.html",
    imageAssets: [
      {
        label: "Page 1",
        path: "4-10 biopsy/LASTERDIANAD (1)/SER00002/UNWRAP/report_0.jpg",
      },
      {
        label: "Page 2",
        path: "4-10 biopsy/LASTERDIANAD (1)/SER00002/UNWRAP/report_1.jpg",
      },
    ],
  },
  {
    biopsyId: "biopsy-2026-03-23",
    title: "March 23 axilla biopsy original scan",
    kind: "pdf",
    primaryPath:
      "3-23 - US Axilla biopsy/Scan - US AXILLA CORE BIOPSY RIGHT - Mar 23, 2026.PDF",
    htmlPath: "3-23 - US Axilla biopsy/SER00003/UNWRAP/report.html",
  },
  {
    biopsyId: "biopsy-2026-03-13",
    title: "March 13 breast biopsy original scan",
    kind: "pdf",
    primaryPath: "3-13 - Biopsy/Copy of 3_13 - breast biopsy report.pdf",
  },
];

export function getDiagnosticReportByBiopsyId(biopsyId: string | null | undefined) {
  if (!biopsyId) return null;
  return DIAGNOSTIC_REPORTS.find((report) => report.biopsyId === biopsyId) ?? null;
}

export async function resolveDiagnosticReport(
  biopsyId: string,
): Promise<ResolvedDiagnosticReport | null> {
  const report = getDiagnosticReportByBiopsyId(biopsyId);
  if (!report) return null;

  for (const root of getDiagnosticsRootCandidates()) {
    const absolutePath = report.primaryPath
      ? resolveSafePath(root, report.primaryPath)
      : null;
    const absoluteHtmlPath = report.htmlPath
      ? resolveSafePath(root, report.htmlPath)
      : null;
    const imageAssets = (report.imageAssets ?? [])
      .map((asset) => {
        const absoluteAssetPath = resolveSafePath(root, asset.path);
        return absoluteAssetPath ? { ...asset, absolutePath: absoluteAssetPath } : null;
      })
      .filter((asset): asset is DiagnosticReportAsset & { absolutePath: string } =>
        Boolean(asset),
      );

    const hasPrimary = absolutePath ? await fileExists(absolutePath) : false;
    const hasHtml = absoluteHtmlPath ? await fileExists(absoluteHtmlPath) : false;
    const existingImages = [];
    for (const image of imageAssets) {
      if (await fileExists(image.absolutePath)) existingImages.push(image);
    }

    if (hasPrimary || hasHtml || existingImages.length) {
      return {
        report,
        root,
        absolutePath: hasPrimary ? absolutePath : null,
        absoluteHtmlPath: hasHtml ? absoluteHtmlPath : null,
        imageAssets: existingImages,
      };
    }
  }

  return null;
}

export function getDiagnosticReportHref(biopsyId: string) {
  return `/api/diagnostic-reports/${encodeURIComponent(biopsyId)}`;
}

export function getDiagnosticReportAssetHref(biopsyId: string, assetPath: string) {
  return `/api/diagnostic-reports/${encodeURIComponent(biopsyId)}?asset=${encodeURIComponent(
    assetPath,
  )}`;
}

export function resolveWhitelistedReportAsset(
  resolved: ResolvedDiagnosticReport,
  assetPath: string | null,
) {
  if (!assetPath) return null;
  return (
    resolved.imageAssets.find((asset) => asset.path === assetPath) ??
    null
  );
}

export async function readReportHtmlBody(absoluteHtmlPath: string | null) {
  if (!absoluteHtmlPath) return null;
  const raw = await fs.readFile(absoluteHtmlPath, "utf8");
  const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw;
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

export function getReportMimeType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveSafePath(root: string, relativePath: string) {
  const absolutePath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  return absolutePath;
}

async function fileExists(absolutePath: string) {
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
