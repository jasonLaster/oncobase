import fs from "fs";
import path from "path";
import type archiver from "archiver";

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);
const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

export function addDirToDiskArchive(
  arc: archiver.Archiver,
  dir: string,
  basePath = ""
) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const zipPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirToDiskArchive(arc, fullPath, zipPath);
    } else {
      arc.file(fullPath, { name: zipPath });
    }
  }
}
