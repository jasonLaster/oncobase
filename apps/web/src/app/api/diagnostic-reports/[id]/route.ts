import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import {
  getDiagnosticReportAssetHref,
  getReportMimeType,
  readReportHtmlBody,
  resolveDiagnosticReport,
  resolveWhitelistedReportAsset,
} from "@/lib/diagnostic-reports";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const biopsyId = decodeURIComponent(id);
  const resolved = await resolveDiagnosticReport(biopsyId);
  if (!resolved) {
    return NextResponse.json({ error: "Diagnostic report not found" }, { status: 404 });
  }

  const asset = resolveWhitelistedReportAsset(
    resolved,
    request.nextUrl.searchParams.get("asset"),
  );
  if (asset) {
    return streamFile(asset.absolutePath, asset.label);
  }

  if (resolved.report.kind === "pdf" && resolved.absolutePath) {
    return streamFile(resolved.absolutePath, path.basename(resolved.absolutePath));
  }

  if (resolved.report.kind === "image-html") {
    const body = await readReportHtmlBody(resolved.absoluteHtmlPath);
    return new Response(renderImageReportHtml(biopsyId, resolved.report.title, body, resolved.imageAssets), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  return NextResponse.json({ error: "Diagnostic report not readable" }, { status: 404 });
}

async function streamFile(absolutePath: string, filename: string) {
  try {
    const data = await fs.readFile(absolutePath);
    return new Response(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${sanitizeFilename(filename)}"`,
        "Content-Length": String(data.byteLength),
        "Content-Type": getReportMimeType(absolutePath),
      },
    });
  } catch {
    return NextResponse.json({ error: "Diagnostic report asset not readable" }, { status: 404 });
  }
}

function renderImageReportHtml(
  biopsyId: string,
  title: string,
  body: string | null,
  images: Array<{ label: string; path: string }>,
) {
  const imageMarkup = images
    .map(
      (image) =>
        `<figure><img src="${escapeHtmlAttribute(
          getDiagnosticReportAssetHref(biopsyId, image.path),
        )}" alt="${escapeHtmlAttribute(image.label)}"><figcaption>${escapeHtml(
          image.label,
        )}</figcaption></figure>`,
    )
    .join("");
  const textSection = body
    ? `<section class="report-text" aria-label="Extracted report text">${body}</section>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    main { margin: 0 auto; max-width: 980px; padding: 24px; }
    header { align-items: baseline; border-bottom: 1px solid #cbd5e1; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 20px; padding-bottom: 14px; }
    h1 { font-size: 22px; line-height: 1.2; margin: 0; }
    a { color: #155e75; }
    .report-text { background: white; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; line-height: 1.55; margin-bottom: 20px; padding: 18px; }
    .report-text h1, .report-text h2, .report-text h3 { margin: 0 0 12px; }
    figure { background: white; border: 1px solid #cbd5e1; border-radius: 8px; margin: 0 0 20px; padding: 12px; }
    img { display: block; height: auto; margin: 0 auto; max-width: 100%; }
    figcaption { color: #475569; font-size: 12px; margin-top: 8px; text-align: center; }
    @media print {
      body { background: white; }
      main { max-width: none; padding: 0; }
      header, .report-text { display: none; }
      figure { border: 0; break-after: page; margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <a href="javascript:window.print()">Print / Save PDF</a>
    </header>
    ${textSection}
    ${imageMarkup}
  </main>
</body>
</html>`;
}

function sanitizeFilename(filename: string) {
  return filename.replace(/["\r\n]/g, "_");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value);
}
