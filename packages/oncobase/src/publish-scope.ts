import fs from "node:fs";
import { execFileSync } from "node:child_process";
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

/** Explicit committed range, never a guessed last-publish baseline. Ref arguments
 * are resolved without a shell; deletions/assets require an explicitly reviewed plan. */
export function readGitPublishScope(vault: string, ref: string): Set<string> {
  const git = (args: string[]) => execFileSync("git", ["-C", vault, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!ref || ref.startsWith("-")) throw new Error("--changed-since requires a Git commit/ref");
  const base = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  const fields = git(["diff", "--no-ext-diff", "--no-renames", "--relative", "--name-status", "-z", base, "HEAD", "--", "."]).split("\0");
  const slugs = new Set<string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, file] = [fields[i], fields[i + 1]];
    if (!["A", "M"].includes(status) || !/\.mdx?$/.test(file) || file.includes("\\") || file.split("/").some(p => !p || p === "." || p === "..")) {
      throw new Error("--changed-since includes deletions, renames, assets or non-Markdown changes; use a reviewed --files-from scope or whole-vault publish");
    }
    slugs.add(file.replace(/\.mdx?$/, ""));
  }
  return slugs;
}
