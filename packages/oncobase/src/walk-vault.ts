import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isSensitiveFrontmatter, normalizeFrontmatterTags } from "./sensitive-pages";

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
  ".dcm",
  ".dicom",
  ".doc",
  ".docx",
  ".gz",
  ".jpg",
  ".jpeg",
  ".json",
  ".png",
  ".gif",
  ".ppt",
  ".pptx",
  ".rtf",
  ".webp",
  ".svg",
  ".csv",
  ".tar",
  ".tif",
  ".tiff",
  ".tsv",
  ".txt",
  ".xls",
  ".xlsx",
  ".xml",
  ".zip",
]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx"]);

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".dcm": "application/dicom",
  ".dicom": "application/dicom",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gz": "application/gzip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".csv": "text/csv",
  ".tar": "application/x-tar",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

export type PublishDocument = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  sensitiveInclude: string[];
  hash: string;
  sensitive: boolean;
};

export type PublishAsset = {
  filePath: string;
  relativePath: string;
  kind: "pdf" | "file";
  contentType: string;
  sizeBytes: number;
  hash: string;
  ownerSlugs: string[];
  sensitive: boolean;
  sensitiveInclude: string[];
  visibilityHash: string;
};

// Bumped when the hash recipe changes (fields hashed, JSON shape,
// whitespace handling, redaction stage, etc.). Stored alongside each
// doc's contentHash so /begin can distinguish "content edited" from
// "hash format upgraded" — the difference matters because a format
// upgrade doesn't need to regenerate embeddings.
//
// History:
//   1 — JSON.stringify({title, content, tags}) over RAW vault content
//   2 — includes the sensitive flag in the hashed document payload
//   3 — includes sensitiveInclude and migrates legacy *-sensitive tags
export const HASH_FUNCTION_VERSION = 3;

export function hashBytes(content: string | Buffer) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function hashFile(filePath: string) {
  const buf = fs.readFileSync(filePath);
  return hashBytes(buf);
}

function isGitLfsPointer(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(128);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8");
    return head.startsWith("version https://git-lfs.github.com/spec/v1\n");
  } finally {
    fs.closeSync(fd);
  }
}

export function hashDocument(
  doc: Pick<PublishDocument, "title" | "content" | "tags"> & {
    sensitive?: boolean;
    sensitiveInclude?: string[];
  },
) {
  return hashBytes(
    JSON.stringify({
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      sensitive: doc.sensitive === true,
      sensitiveInclude: doc.sensitiveInclude ?? [],
    }),
  );
}

const LEGACY_SENSITIVE_INCLUDE_TAGS = new Map([
  ["echo-sensitive", "echo"],
  ["serova-sensitive", "serova"],
]);

function normalizeSensitiveInclude(
  frontmatter: Record<string, unknown>,
  tags: string[],
) {
  const explicit = normalizeFrontmatterTags(
    frontmatter["sensitive-include"] ?? frontmatter.sensitiveInclude,
  );
  const migrated = tags
    .map((tag) => LEGACY_SENSITIVE_INCLUDE_TAGS.get(tag.trim().toLowerCase()))
    .filter((tag): tag is string => Boolean(tag));
  return Array.from(
    new Set([...explicit, ...migrated].map((tag) => tag.toLowerCase())),
  );
}

function removeLegacySensitiveIncludeTags(tags: string[]) {
  return tags.filter(
    (tag) => !LEGACY_SENSITIVE_INCLUDE_TAGS.has(tag.trim().toLowerCase()),
  );
}

type Entry = { filePath: string; relativePath: string };

type DocumentEntry = {
  document: PublishDocument;
  relativePath: string;
  raw: string;
};

function walkFilesystem(dir: string, basePath = ""): Entry[] {
  const out: Entry[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkFilesystem(fullPath, relativePath));
    } else {
      out.push({ filePath: fullPath, relativePath });
    }
  }
  return out;
}

function gitVisibleFiles(vaultPath: string): Entry[] | null {
  try {
    const resolvedVaultPath = fs.realpathSync(vaultPath);
    const gitRoot = fs.realpathSync(execFileSync(
      "git",
      ["-C", resolvedVaultPath, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim());
    const vaultRelative = path.relative(gitRoot, resolvedVaultPath) || ".";
    const raw = execFileSync(
      "git",
      [
        "-C",
        gitRoot,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        vaultRelative,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
    const prefix = vaultRelative === "." ? "" : `${vaultRelative.split(path.sep).join("/")}/`;
    return raw
      .split("\0")
      .filter(Boolean)
      .map((gitPath) => {
        const normalizedGitPath = gitPath.split(path.sep).join("/");
        const relativePath = prefix
          ? normalizedGitPath.slice(prefix.length)
          : normalizedGitPath;
        return {
          filePath: path.join(resolvedVaultPath, ...relativePath.split("/")),
          relativePath,
        };
      })
      .filter(({ filePath }) => fs.existsSync(filePath));
  } catch {
    return null;
  }
}

function globPattern(pattern: string) {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index++;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function oncobaseIgnoreMatchers(vaultPath: string) {
  const ignorePath = path.join(vaultPath, ".oncobaseignore");
  if (!fs.existsSync(ignorePath)) return [] as RegExp[];
  return fs
    .readFileSync(ignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const normalized = line.replace(/^\/+/, "");
      return globPattern(normalized.endsWith("/") ? `${normalized}**` : normalized);
    });
}

function vaultFiles(vaultPath: string): Entry[] {
  const files = gitVisibleFiles(vaultPath) ?? walkFilesystem(vaultPath);
  const ignoreMatchers = oncobaseIgnoreMatchers(vaultPath);
  return files.filter(({ relativePath }) => {
    const segments = relativePath.split("/");
    if (segments.some((segment) => segment.startsWith("."))) return false;
    if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return false;
    if (EXCLUDED_FILES.has(path.posix.basename(relativePath))) return false;
    return !ignoreMatchers.some((matcher) => matcher.test(relativePath));
  });
}

function parseDocumentEntry({ filePath, relativePath }: Entry): DocumentEntry {
  const slug = relativePath.replace(/\.(?:md|mdx)$/i, "");
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
  const rawTags = normalizeFrontmatterTags(data.tags);
  const tags = removeLegacySensitiveIncludeTags(rawTags);
  const sensitiveInclude = normalizeSensitiveInclude(data, rawTags);
  const sensitive = isSensitiveFrontmatter(data as Record<string, unknown>);
  return {
    relativePath,
    raw,
    document: {
      slug,
      title,
      content: body,
      tags,
      sensitiveInclude,
      sensitive,
      hash: hashDocument({
        title,
        content: body,
        tags,
        sensitiveInclude,
        sensitive,
      }),
    },
  };
}

function documentEntries(vaultPath: string) {
  return vaultFiles(vaultPath)
    .filter(({ relativePath }) => DOCUMENT_EXTENSIONS.has(path.extname(relativePath)))
    .map(parseDocumentEntry);
}

export function readVaultDocuments(vaultPath: string): PublishDocument[] {
  return documentEntries(vaultPath).map(({ document }) => document);
}

function referencedAssetPaths(
  raw: string,
  documentPath: string,
  assetPaths: Set<string>,
  assetsByBasename: Map<string, string[]>,
) {
  const references: string[] = [];
  const patterns = [
    /!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/gi,
    /!?\[[^\]]*\]\(([^)]+)\)/g,
    /(?:src|href)=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw))) {
      references.push(match[1].trim());
    }
  }

  const resolved = new Set<string>();
  const documentDir = path.posix.dirname(documentPath);
  for (let reference of references) {
    reference = reference.replace(/^<|>$/g, "").replace(/\s+["'].*$/, "");
    try {
      if (reference.includes("/api/file?")) {
        const url = new URL(reference, "https://oncobase.local");
        reference = url.searchParams.get("path") ?? reference;
      } else {
        reference = decodeURIComponent(reference.split(/[?#]/)[0]);
      }
    } catch {
      // Preserve malformed-but-otherwise-usable local references.
    }
    if (!reference || /^(?:https?:|data:|mailto:)/i.test(reference)) continue;
    reference = reference.replace(/^\/+/, "").replace(/^obsidian\//, "");
    if (assetPaths.has(reference)) {
      resolved.add(reference);
      continue;
    }
    const relative = path.posix.normalize(path.posix.join(documentDir, reference));
    if (assetPaths.has(relative)) {
      resolved.add(relative);
      continue;
    }
    const basenameMatches = assetsByBasename.get(path.posix.basename(reference)) ?? [];
    if (basenameMatches.length === 1) resolved.add(basenameMatches[0]);
  }
  return resolved;
}

export function readVaultAssets(vaultPath: string): PublishAsset[] {
  const entries = vaultFiles(vaultPath);
  const documents = entries
    .filter(({ relativePath }) => DOCUMENT_EXTENSIONS.has(path.extname(relativePath)))
    .map(parseDocumentEntry);
  const assets: PublishAsset[] = [];
  for (const { filePath, relativePath } of entries) {
    const ext = path.extname(filePath).toLowerCase();
    const isPdf = PDF_EXTENSIONS.has(ext);
    const isFile = FILE_ASSET_EXTENSIONS.has(ext);
    if (!isPdf && !isFile) continue;
    if (isGitLfsPointer(filePath)) {
      throw new Error(
        `Refusing to publish unresolved Git LFS pointer asset: ${relativePath}`,
      );
    }
    const stat = fs.statSync(filePath);
    assets.push({
      filePath,
      relativePath,
      kind: isPdf ? "pdf" : "file",
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      sizeBytes: stat.size,
      hash: hashFile(filePath),
      ownerSlugs: [],
      sensitive: false,
      sensitiveInclude: [],
      visibilityHash: "",
    });
  }

  const assetPaths = new Set(assets.map((asset) => asset.relativePath));
  const assetsByBasename = new Map<string, string[]>();
  for (const asset of assets) {
    const basename = path.posix.basename(asset.relativePath);
    const matches = assetsByBasename.get(basename) ?? [];
    matches.push(asset.relativePath);
    assetsByBasename.set(basename, matches);
  }
  const ownersByAssetPath = new Map<string, Set<string>>();
  const documentBySlug = new Map(
    documents.map(({ document }) => [document.slug, document]),
  );
  for (const { document, relativePath, raw } of documents) {
    for (const assetPath of referencedAssetPaths(
      raw,
      relativePath,
      assetPaths,
      assetsByBasename,
    )) {
      const owners = ownersByAssetPath.get(assetPath) ?? new Set<string>();
      owners.add(document.slug);
      ownersByAssetPath.set(assetPath, owners);
    }
  }
  for (const asset of assets) {
    const stem = asset.relativePath.replace(/\.[^/.]+$/, "");
    const owners = ownersByAssetPath.get(asset.relativePath) ?? new Set<string>();
    if (documentBySlug.has(stem)) owners.add(stem);
    asset.ownerSlugs = Array.from(owners).sort();
    const ownerDocuments = asset.ownerSlugs
      .map((slug) => documentBySlug.get(slug))
      .filter((document): document is PublishDocument => Boolean(document));
    asset.sensitive = ownerDocuments.some((document) => document.sensitive);
    asset.sensitiveInclude = Array.from(
      new Set(ownerDocuments.flatMap((document) => document.sensitiveInclude)),
    ).sort();
    asset.visibilityHash = hashBytes(
      JSON.stringify({
        ownerSlugs: asset.ownerSlugs,
        sensitive: asset.sensitive,
        sensitiveInclude: asset.sensitiveInclude,
      }),
    );
  }
  return assets;
}
