import fs from "fs";
import path from "path";
import JSZip from "jszip";

const OBSIDIAN_DIR = path.join(process.cwd(), "..", "obsidian");
const STATIC_ZIP = path.join(process.cwd(), "public", "diana-tnbc-wiki.zip");

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);

const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

function addFilesToZip(zip: JSZip, dir: string, basePath: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const zipPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      addFilesToZip(zip, fullPath, zipPath);
    } else {
      zip.file(zipPath, fs.readFileSync(fullPath));
    }
  }
}

export async function GET() {
  // In production, serve the pre-built static zip
  if (fs.existsSync(STATIC_ZIP)) {
    const buffer = fs.readFileSync(STATIC_ZIP);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="diana-tnbc-wiki.zip"',
      },
    });
  }

  // In dev, generate on the fly (includes all file types)
  const zip = new JSZip();
  addFilesToZip(zip, OBSIDIAN_DIR, "");
  const blob = await zip.generateAsync({ type: "blob" });

  return new Response(blob, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="diana-tnbc-wiki.zip"',
    },
  });
}
