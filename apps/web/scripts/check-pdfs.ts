/**
 * Check that all local vault PDFs are uploaded to Convex.
 * Exits with code 1 if any PDFs are missing from Convex.
 *
 * Usage: bun scripts/check-pdfs.ts
 *
 * Requires:
 *   NEXT_PUBLIC_CONVEX_URL — Convex deployment URL
 */
import fs from "fs";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set — cannot check PDFs");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);
const OBSIDIAN_DIR = path.join(__dirname, "..", "..", "..", "obsidian");

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);

function* findPdfs(
  dir: string,
  basePath = ""
): Generator<{ fullPath: string; relativePath: string }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* findPdfs(fullPath, relativePath);
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      yield { fullPath, relativePath };
    }
  }
}

function isGitLfsPointer(filePath: string): boolean {
  const stat = fs.statSync(filePath);
  if (stat.size > 200) return false;
  const content = fs.readFileSync(filePath, "utf8");
  return content.includes("git-lfs");
}

async function main() {
  const existing = await client.query(api.documents.listPdfAssets, {});
  const existingPaths = new Set(existing.map((a) => a.path));

  const localPdfs = [...findPdfs(OBSIDIAN_DIR)];
  const missing = localPdfs.filter(
    (p) => !existingPaths.has(p.relativePath) && !isGitLfsPointer(p.fullPath)
  );

  console.log(
    `PDFs: ${localPdfs.length} local, ${existing.length} in Convex, ${missing.length} missing`
  );

  if (missing.length > 0) {
    console.error("\nMissing PDFs (not uploaded to Convex):");
    for (const { relativePath } of missing) {
      console.error(`  - ${relativePath}`);
    }
    console.error(
      `\nRun: cd apps/web && bun run wiki:publish --site diana`,
    );
    process.exit(1);
  }

  console.log("All PDFs are uploaded to Convex.");
}

main().catch((err) => {
  console.error("PDF check failed:", err);
  process.exit(1);
});
