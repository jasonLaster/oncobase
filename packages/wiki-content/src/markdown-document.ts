import crypto from "node:crypto";

export const HASH_FUNCTION_VERSION = 3;

export const EXCLUDED_DIRS = new Set([
  ".obsidian",
  ".claude",
  "Google Drive",
  "Clippings",
  "Precision medicine",
  "node_modules",
]);

export const EXCLUDED_FILES = new Set(["CLAUDE.md"]);

export const PDF_EXTENSIONS = new Set([".pdf"]);

export const FILE_ASSET_EXTENSIONS = new Set([
  ".avif",
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

const SENSITIVE_PAGE_TAG = "sensitive";
const SENSITIVE_FRONTMATTER_KEYS = new Set(["sensitive"]);
const TRUTHY_FRONTMATTER_VALUES = new Set(["1", "true", "yes", "on"]);
const LEGACY_SENSITIVE_INCLUDE_TAGS = new Map([
  ["echo-sensitive", "echo"],
  ["serova-sensitive", "serova"],
]);

export type ParsedMarkdownDocument = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  sensitiveInclude: string[];
  sensitive: boolean;
  hash: string;
};

export type SplitFrontmatterResult = {
  /** Exact frontmatter bytes including delimiters and trailing newline, or "" if absent. */
  frontmatterBlock: string;
  /** Parsed key/value pairs from frontmatter. */
  data: Record<string, unknown>;
  /** Exact body bytes after frontmatter (with original line endings). */
  body: string;
};

export function hashBytes(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function hashDocument(doc: {
  title: string;
  content: string;
  tags: string[];
  sensitive?: boolean;
  sensitiveInclude?: string[];
}): string {
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

function unquoteYamlScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null" || trimmed === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseFlowArray(raw: string): unknown[] {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  const items: unknown[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < inner.length) {
        current += ch + inner[++i]!;
      } else if (ch === quote) {
        quote = null;
        current += ch;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      const value = unquoteYamlScalar(current);
      if (value !== "") items.push(value);
      current = "";
    } else {
      current += ch;
    }
  }
  const tail = unquoteYamlScalar(current);
  if (tail !== "") items.push(tail);
  return items;
}

function stripInlineYamlComment(value: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < value.length) {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(value[i - 1]!))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

/**
 * Minimal YAML frontmatter parser matching Obsidian vault conventions (scalars,
 * flow arrays `[a, b]`, block lists `- item`, quoted strings, booleans).
 * Preserves the exact frontmatter bytes separately so callers never re-serialize YAML.
 */
export function splitFrontmatter(raw: string): SplitFrontmatterResult {
  const openMatch = raw.match(/^---[ \t]*\r?\n/);
  if (!openMatch) {
    return { frontmatterBlock: "", data: {}, body: raw };
  }
  const afterOpen = openMatch[0].length;
  const rest = raw.slice(afterOpen);
  const closeMatch = rest.match(/^---[ \t]*(?:\r?\n|$)/m);
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatterBlock: "", data: {}, body: raw };
  }
  const yamlText = rest.slice(0, closeMatch.index);
  const blockEnd = afterOpen + closeMatch.index + closeMatch[0].length;
  const frontmatterBlock = raw.slice(0, blockEnd);
  const body = raw.slice(blockEnd);

  const data: Record<string, unknown> = {};
  const lines = yamlText.split(/\r?\n/);
  let currentListKey: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (currentListKey && /^[ \t]*-[ \t]+(.*)$/.test(line)) {
      const itemMatch = line.match(/^[ \t]*-[ \t]+(.*)$/);
      if (itemMatch) {
        const list = (data[currentListKey] as unknown[]) ?? [];
        list.push(unquoteYamlScalar(stripInlineYamlComment(itemMatch[1]!)));
        data[currentListKey] = list;
      }
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/);
    if (!keyMatch) {
      currentListKey = null;
      continue;
    }
    const key = keyMatch[1]!;
    const rawValue = stripInlineYamlComment(keyMatch[2]!).trim();
    if (!rawValue) {
      currentListKey = key;
      data[key] = [];
      continue;
    }
    currentListKey = null;
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      data[key] = parseFlowArray(rawValue);
    } else {
      data[key] = unquoteYamlScalar(rawValue);
    }
  }

  return { frontmatterBlock, data, body };
}

export function normalizeFrontmatterTags(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isTruthyFrontmatterValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return TRUTHY_FRONTMATTER_VALUES.has(value.trim().toLowerCase());
}

export function isSensitiveFrontmatter(frontmatter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(frontmatter)) {
    if (
      SENSITIVE_FRONTMATTER_KEYS.has(key.toLowerCase()) &&
      isTruthyFrontmatterValue(value)
    ) {
      return true;
    }
  }
  return normalizeFrontmatterTags(frontmatter.tags).some(
    (tag) => tag.trim().toLowerCase() === SENSITIVE_PAGE_TAG,
  );
}

function normalizeSensitiveInclude(
  frontmatter: Record<string, unknown>,
  tags: string[],
): string[] {
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

function removeLegacySensitiveIncludeTags(tags: string[]): string[] {
  return tags.filter(
    (tag) => !LEGACY_SENSITIVE_INCLUDE_TAGS.has(tag.trim().toLowerCase()),
  );
}

/**
 * Find the first Markdown H1 heading line (`/^#\s+.+$/m`) in a body, matching
 * `packages/oncobase/src/walk-vault.ts` exactly.
 */
export function findFirstH1(body: string): { lineIndex: number; text: string; heading: string } | null {
  const match = body.match(/^#\s+(.+)$/m);
  if (!match || match.index === undefined) return null;
  const lineIndex = body.slice(0, match.index).split("\n").length - 1;
  return { lineIndex, text: match[0]!, heading: match[1]! };
}

/**
 * Parse a raw Markdown vault file into its canonical Oncobase publish record
 * (matching `packages/oncobase/src/walk-vault.ts` hash v3 semantics).
 */
export function parseMarkdownDocument(slug: string, raw: string): ParsedMarkdownDocument {
  const { data, body: rawBody } = splitFrontmatter(raw);
  const h1Match = rawBody.match(/^#\s+(.+)$/m);
  const title =
    (typeof data.title === "string" && data.title) ||
    h1Match?.[1] ||
    slug.split("/").pop() ||
    slug;
  const content = h1Match
    ? rawBody.replace(/^#\s+.+$/m, "").replace(/^\n+/, "")
    : rawBody;
  const rawTags = normalizeFrontmatterTags(data.tags);
  const tags = removeLegacySensitiveIncludeTags(rawTags);
  const sensitiveInclude = normalizeSensitiveInclude(data, rawTags);
  const sensitive = isSensitiveFrontmatter(data);
  return {
    slug,
    title,
    content,
    tags,
    sensitiveInclude,
    sensitive,
    hash: hashDocument({ title, content, tags, sensitiveInclude, sensitive }),
  };
}

function normalizeReferenceTarget(raw: string): string {
  let reference = raw.trim().replace(/^<|>$/g, "").replace(/\s+["'].*$/, "");
  try {
    if (reference.includes("/api/file?")) {
      const url = new URL(reference, "https://oncobase.local");
      reference = url.searchParams.get("path") ?? reference;
    } else {
      reference = decodeURIComponent(reference.split(/[?#]/)[0] ?? "");
    }
  } catch {
    // Keep malformed-but-usable reference as-is.
  }
  return reference.trim();
}

function hasAssetExtension(target: string): boolean {
  const dot = target.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = target.slice(dot).toLowerCase();
  return PDF_EXTENSIONS.has(ext) || FILE_ASSET_EXTENSIONS.has(ext);
}

/**
 * Extract all local asset and transclusion references whose addition or removal
 * would affect asset ownership (`ownerSlugs`) or `visibilityHash` in Convex.
 * Mirrors the reference patterns in `packages/oncobase/src/walk-vault.ts`.
 */
export function extractAssetAndEmbedReferences(raw: string): string[] {
  const refs = new Set<string>();

  const addIfAssetOrEmbed = (rawTarget: string, isEmbed: boolean) => {
    const trimmed = rawTarget.trim();
    if (!trimmed) return;
    if (/^(?:https?:|data:|mailto:)/i.test(trimmed)) return;
    const normalized = normalizeReferenceTarget(trimmed);
    if (!normalized || /^(?:https?:|data:|mailto:)/i.test(normalized)) return;
    if (isEmbed || trimmed.includes("/api/file?") || hasAssetExtension(normalized)) {
      refs.add(normalized);
    }
  };

  for (const match of raw.matchAll(/(!)?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/gi)) {
    addIfAssetOrEmbed(match[2]!, Boolean(match[1]));
  }
  for (const match of raw.matchAll(/(!)?\[[^\]]*\]\(([^)]+)\)/g)) {
    addIfAssetOrEmbed(match[2]!, Boolean(match[1]));
  }
  for (const match of raw.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const isSrc = match[0]!.toLowerCase().startsWith("src=");
    addIfAssetOrEmbed(match[1]!, isSrc);
  }
  for (const match of raw.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = match[1]!;
    if (!/\sdata-theme-pair(?:\s|=|\/?$)/i.test(attributes)) continue;
    const src = attributes.match(/(?:^|\s)src\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src && /-light\.[a-zA-Z0-9]+$/.test(src)) {
      addIfAssetOrEmbed(src.replace(/-light(\.[a-zA-Z0-9]+)$/, "-dark$1"), true);
    }
  }

  return Array.from(refs).sort();
}

function globPattern(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
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

export function compileOncobaseIgnore(content: string | null | undefined): RegExp[] {
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const normalized = line.replace(/^\/+/, "");
      return globPattern(normalized.endsWith("/") ? `${normalized}**` : normalized);
    });
}

export function isExcludedVaultPath(relativePath: string, ignoreMatchers: readonly RegExp[] = []): boolean {
  const normalized = relativePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("\\")) return true;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return true;
  }
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return true;
  const basename = segments[segments.length - 1]!;
  if (EXCLUDED_FILES.has(basename)) return true;
  return ignoreMatchers.some((matcher) => matcher.test(normalized));
}
