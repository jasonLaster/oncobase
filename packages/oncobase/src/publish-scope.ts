import fs from "node:fs";
import type { DependencyCacheMode } from "./dependency-cache";
import path from "node:path";
import { readVaultSelection } from "./walk-vault";

export type AssetMode = "none" | "referenced" | "all";

export function readPublishScope(file: string): Set<string> {
  const paths: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(paths) || paths.length === 0 || paths.some(p =>
    typeof p !== "string" || !/\.mdx?$/.test(p) || path.posix.isAbsolute(p) ||
    p.includes("\\") || p.split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error("--files-from must contain a nonempty JSON array of vault-relative .md/.mdx paths");
  }
  return new Set(paths.map(p => p.replace(/\.mdx?$/, "")));
}

export function readPublishSelection(vault: string, slugs: ReadonlySet<string>, assetMode: AssetMode, cache?: DependencyCacheMode, cacheDirectory?: string) {
  const selected = readVaultSelection(vault, { slugs, assetMode, cache, cacheDirectory });
  if (selected.documents.length !== slugs.size) throw new Error("Publish scope contains missing, excluded, or ambiguous documents");
  return selected;
}
