/**
 * Build-time script to generate a zip of the entire wiki (md, pdf, images, etc.).
 * Outputs to public/diana-tnbc-wiki.zip so it can be served statically.
 *
 * Usage: npx tsx scripts/build-wiki-zip.ts
 */
import fs from "fs";
import path from "path";
import JSZip from "jszip";

const OBSIDIAN_DIR = path.join(__dirname, "..", "..", "obsidian");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "diana-tnbc-wiki.zip");

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

async function main() {
  const zip = new JSZip();
  addFilesToZip(zip, OBSIDIAN_DIR, "");

  const fileCount = Object.keys(zip.files).filter((f) => !zip.files[f].dir).length;
  console.log(`Zipping ${fileCount} files...`);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  // Ensure public/ exists
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, buffer);

  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`Written ${OUTPUT_PATH} (${sizeMB} MB)`);
}

main().catch((err) => {
  console.error("Zip generation failed:", err);
  process.exit(1);
});
