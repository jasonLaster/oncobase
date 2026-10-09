// Export a reviewed committed education tree, never the working tree or private Git history.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compileEducation, type SourcePage } from "../lib/content-format";
const [repo, destination, ref = "origin/main"] = process.argv.slice(2);
if (!repo || !destination) throw Error("Usage: bun scripts/copy-content.ts <diana-repo> <empty-destination> [commit/ref]");
if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw Error("Export destination must be empty");
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 32 * 1024 * 1024 });
const sha = git("rev-parse", ref).toString().trim();
const files = git("ls-tree", "-r", "--name-only", sha, "obsidian/wiki/education").toString().trim().split("\n");
const sources: SourcePage[] = files.filter(file => file.endsWith(".md")).map(file => ({ path: file.slice("obsidian/".length), raw: git("show", `${sha}:${file}`).toString() }));
const assets = new Set<string>();
const pages = compileEducation(sources, asset => assets.add(asset));
const hashes: Record<string, string> = {};
function write(relative: string, bytes: Buffer) {
  const target = path.join(destination!, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  hashes[relative] = createHash("sha256").update(bytes).digest("hex");
}
for (const source of sources) write(source.path, Buffer.from(source.raw));
const common = path.resolve(repo, git("rev-parse", "--git-common-dir").toString().trim());
for (const asset of [...assets].sort()) {
  let bytes = git("show", `${sha}:obsidian/${asset}`);
  if (bytes.toString("utf8", 0, 80).startsWith("version https://git-lfs.github.com/spec/v1")) {
    const pointer = bytes.toString();
    const oid = pointer.match(/oid sha256:([a-f0-9]{64})/)?.[1];
    if (!oid) throw Error(`Invalid LFS pointer: ${asset}`);
    bytes = fs.readFileSync(path.join(common, "lfs/objects", oid.slice(0, 2), oid.slice(2, 4), oid));
    if (createHash("sha256").update(bytes).digest("hex") !== oid || bytes.length !== Number(pointer.match(/size (\d+)/)?.[1])) throw Error(`LFS bytes do not match: ${asset}`);
  }
  write(asset, bytes);
}
fs.writeFileSync(path.join(destination, "provenance.json"), JSON.stringify({ sourceRepository: "jasonLaster/diana-tnbc", sourceCommit: sha, sourcePrefix: "obsidian/", files: hashes }, null, 2) + "\n");
fs.writeFileSync(path.join(destination, "README.md"), `# OncoGuide\n\nPublic cancer education, rendered at https://oncoguide.cc by the Next.js app in [Oncobase](https://github.com/jasonLaster/oncobase/tree/main/apps/oncoguide).\n\nThis initial release copies the existing education Markdown verbatim. Original Diana pages remain available; references outside education continue to point to Diana. All committed material is public. Do not commit private drafts or raw source captures here.\n\nEdit Markdown under \`wiki/education/\`. Keep existing lesson paths stable, preserve citations, and include both files for illustrations marked \`data-theme-pair\`. Assets are local files; the build translates legacy links without modifying Markdown. Content changes trigger validation and a deployment of the dedicated app.\n\n\`provenance.json\` records the source revision and initial file hashes. It is an import receipt, not a requirement that future edits retain the original hash. Public visibility does not grant a new reuse license; retain existing credits and attribution.\n`);
console.info(`Copied ${pages.length} Markdown pages and ${assets.size} referenced assets without changing source bytes`);
