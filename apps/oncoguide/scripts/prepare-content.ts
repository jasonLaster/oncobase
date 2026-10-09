import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { compileEducation, type SourcePage, staticAssetHref } from "../lib/content-format";
const lock = JSON.parse(fs.readFileSync(new URL("../content.lock.json", import.meta.url), "utf8"));
const root = path.resolve(process.env.ONCOGUIDE_CONTENT_DIR || ".generated/content");
if (!process.env.ONCOGUIDE_CONTENT_DIR) {
  fs.mkdirSync(path.dirname(root), { recursive: true });
  if (!fs.existsSync(path.join(root, ".git"))) execFileSync("git", ["clone", "--no-checkout", lock.repository, root], { stdio: "inherit" });
  execFileSync("git", ["-C", root, "fetch", "origin", process.env.ONCOGUIDE_CONTENT_SHA || lock.commit], { stdio: "inherit" });
  execFileSync("git", ["-C", root, "checkout", "--detach", process.env.ONCOGUIDE_CONTENT_SHA || lock.commit], { stdio: "inherit" });
}
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const sources: SourcePage[] = walk(path.join(root, "wiki/education")).filter(file => file.endsWith(".md")).map(file => ({ path: path.relative(root, file).split(path.sep).join("/"), raw: fs.readFileSync(file, "utf8") }));
fs.mkdirSync(".generated", { recursive: true });
fs.mkdirSync("public", { recursive: true });
fs.rmSync("public/assets", { recursive: true, force: true });
const assets = new Set<string>();
const pages = compileEducation(sources, asset => {
  if (assets.has(asset)) return;
  const source = path.join(root, asset);
  const bytes = fs.readFileSync(source);
  if (bytes.toString("utf8", 0, 80).startsWith("version https://git-lfs.github.com/spec/v1")) throw Error(`Unhydrated LFS asset: ${asset}`);
  const target = path.join("public/assets", asset);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  assets.add(asset);
});
fs.writeFileSync(".generated/pages.json", JSON.stringify(pages));
fs.writeFileSync("public/search-index.json", JSON.stringify(pages.map(({ html: _html, ...page }) => page)));
fs.writeFileSync("public/education-manifest.json", JSON.stringify({ pages: pages.map(({ html: _html, text: _text, ...page }) => page), assets: [...assets].map(staticAssetHref) }));
let contentCommit = process.env.ONCOGUIDE_CONTENT_SHA || (process.env.ONCOGUIDE_CONTENT_DIR ? process.env.VERCEL_GIT_COMMIT_SHA : undefined);
if (!contentCommit) {
  try { contentCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { contentCommit = "local"; }
}
fs.writeFileSync("public/build-info.json", JSON.stringify({ contentCommit, appCommit: process.env.ONCOGUIDE_APP_SHA || "local" }));
console.info(`Prepared ${pages.length} static lessons and ${assets.size} local assets (${contentCommit})`);
