import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// Walks a local Obsidian vault and yields the publish-ready
// document and asset entries. Used by the publisher CLI in
// scripts/publish/* and re-usable by the operator-side
// scripts/admin/publish-from-vault.ts (Phase 6).

const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);
const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

const PDF_EXTENSIONS = new Set([".pdf"]);
const FILE_ASSET_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".csv",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".csv": "text/csv",
};

export type PublishDocument = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  hash: string;
};

export type PublishAsset = {
  filePath: string;
  relativePath: string;
  kind: "pdf" | "file";
  contentType: string;
  sizeBytes: number;
  hash: string;
};

function hashBytes(content: string | Buffer) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function hashFile(filePath: string) {
  const buf = fs.readFileSync(filePath);
  return hashBytes(buf);
}

function hashDocument(doc: Pick<PublishDocument, "title" | "content" | "tags">) {
  return hashBytes(
    JSON.stringify({
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
    }),
  );
}

type Entry = { filePath: string; relativePath: string };

function vaultFiles(dir: string, basePath = ""): Entry[] {
  const out: Entry[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...vaultFiles(fullPath, relativePath));
    } else {
      out.push({ filePath: fullPath, relativePath });
    }
  }
  return out;
}

export function readVaultDocuments(vaultPath: string): PublishDocument[] {
  return vaultFiles(vaultPath)
    .filter(({ relativePath }) => relativePath.endsWith(".md"))
    .map(({ filePath, relativePath }) => {
      const slug = relativePath.replace(/\.md$/, "");
      const raw = fs.readFileSync(filePath, "utf8");
      let data: Record<string, unknown> = {};
      let content = raw;
      try {
        ({ data, content } = matter(raw));
      } catch {
        // Resilient to malformed frontmatter — fall back to raw body.
      }
      const h1Match = content.match(/^#\s+(.+)$/m);
      const title =
        (data.title as string) ||
        h1Match?.[1] ||
        slug.split("/").pop() ||
        slug;
      const body = h1Match
        ? content.replace(/^#\s+.+$/m, "").replace(/^\n+/, "")
        : content;
      const tags = Array.isArray(data.tags)
        ? (data.tags as unknown[]).filter((tag): tag is string => typeof tag === "string")
        : [];
      return {
        slug,
        title,
        content: body,
        tags,
        hash: hashDocument({ title, content: body, tags }),
      };
    });
}

export function readVaultAssets(vaultPath: string): PublishAsset[] {
  const assets: PublishAsset[] = [];
  for (const { filePath, relativePath } of vaultFiles(vaultPath)) {
    const ext = path.extname(filePath).toLowerCase();
    const isPdf = PDF_EXTENSIONS.has(ext);
    const isFile = FILE_ASSET_EXTENSIONS.has(ext);
    if (!isPdf && !isFile) continue;
    const stat = fs.statSync(filePath);
    assets.push({
      filePath,
      relativePath,
      kind: isPdf ? "pdf" : "file",
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      sizeBytes: stat.size,
      hash: hashFile(filePath),
    });
  }
  return assets;
}
