import fs from "node:fs";
import path from "node:path";
import { readVaultAssets, readVaultDocuments } from "./walk-vault";
import { publishProfile } from "./publish-profile";

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

export function readPublishSelection(vault: string, slugs: ReadonlySet<string>, assetMode: AssetMode) {
  const documents = publishProfile.sync("scan.documents", () => {
    const docs = readVaultDocuments(vault).filter(doc => slugs.has(doc.slug));
    if (docs.length !== slugs.size) throw new Error("Publish scope contains missing, excluded, or ambiguous documents");
    publishProfile.metric("items", docs.length);
    return docs;
  });
  const assets = publishProfile.sync("scan.assets", () => {
    const selected = assetMode === "none" ? [] : readVaultAssets(vault,
      assetMode === "referenced" ? { referencedBy: slugs } : {});
    publishProfile.metric("items", selected.length);
    publishProfile.metric("bytes", selected.reduce((sum, a) => sum + a.sizeBytes, 0));
    return selected;
  });
  return { documents, assets };
}
