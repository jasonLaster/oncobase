import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildEducationCorpus } from "@oncobase/education/chat-index";
import { buildEducationVisuals } from "@oncobase/education/visual-index";
import { EducationLessonSchema } from "@oncobase/education/visuals";
import { compileEducation, educationLessons, type SourcePage, staticAssetHref } from "../lib/content-format";
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
const sources: SourcePage[] = walk(path.join(root, "wiki/education")).filter(file => file.endsWith(".md")).sort().map(file => ({ path: path.relative(root, file).split(path.sep).join("/"), raw: fs.readFileSync(file, "utf8") }));
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
fs.writeFileSync("public/chat-index.json", JSON.stringify(buildEducationCorpus(pages, contentCommit)));
// Markup for diagrams and tables is one small file each, fetched only when shown.
// Cartoons are also described by the words drawn on them and the brief they were drawn from.
const readText = (file: string) => {
  const target = path.join(root, file);
  return target.startsWith(`${path.join(root, "wiki/education")}${path.sep}`) && fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
};
const lessons = educationLessons(sources).map(lesson => EducationLessonSchema.parse(lesson));
const { catalog, fragments } = buildEducationVisuals(pages, contentCommit, { readText, lessons });
fs.rmSync("public/visuals", { recursive: true, force: true });
fs.mkdirSync("public/visuals", { recursive: true });
for (const [file, html] of Object.entries(fragments)) fs.writeFileSync(path.join("public", file), JSON.stringify({ html }));
fs.writeFileSync("public/visual-catalog.json", JSON.stringify(catalog));

// Search by meaning is opt-in, because it calls a paid embedding model. Only
// sections whose text changed are embedded again. Without it, chat searches by
// keyword and lesson name.
fs.rmSync("public/search-vectors.json", { force: true });
if (process.env.ONCOGUIDE_SEMANTIC_SEARCH === "1") {
  const { embedMany } = await import("ai");
  const { encodeVectors, semanticText, SEMANTIC_DIMENSIONS, SEMANTIC_MODEL } = await import("@oncobase/education/semantic");
  const { createHash } = await import("node:crypto");
  const cacheFile = ".generated/search-vectors-cache.json";
  const cache: Record<string, number[]> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
  const { sections } = buildEducationCorpus(pages, contentCommit);
  const keyed = sections.map(section => ({ id: section.id, text: semanticText(section), key: createHash("sha256").update(`${SEMANTIC_MODEL}:${SEMANTIC_DIMENSIONS}:${semanticText(section)}`).digest("hex") }));
  const missing = keyed.filter(row => !cache[row.key]);
  try {
    for (let start = 0; start < missing.length; start += 500) {
      const batch = missing.slice(start, start + 500);
      const { embeddings } = await embedMany({ model: SEMANTIC_MODEL, values: batch.map(row => row.text), providerOptions: { openai: { dimensions: SEMANTIC_DIMENSIONS } } });
      batch.forEach((row, index) => { cache[row.key] = embeddings[index]!.map(value => Math.round(value * 127) / 127); });
    }
    fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(keyed.map(row => [row.key, cache[row.key]]))));
    fs.writeFileSync("public/search-vectors.json", JSON.stringify({ version: 1, contentCommit, model: SEMANTIC_MODEL, dimensions: SEMANTIC_DIMENSIONS, ids: keyed.map(row => row.id), vectors: encodeVectors(keyed.map(row => cache[row.key]!)) }));
    console.info(`Search vectors: ${keyed.length} sections, ${missing.length} newly embedded`);
  } catch (error) {
    // The site still builds and chat still searches. Say so plainly.
    console.warn(`Search vectors were not built, so chat will search by keyword only: ${error instanceof Error ? error.message : error}`);
  }
}
fs.writeFileSync("public/build-info.json", JSON.stringify({ contentCommit, appCommit: process.env.ONCOGUIDE_APP_SHA || "local" }));
const count = (kind: string) => catalog.visuals.filter(visual => visual.kind === kind).length;
console.info(`Prepared ${pages.length} static lessons and ${assets.size} local assets (${contentCommit})`);
const cartoons = catalog.visuals.filter(visual => visual.kind === "cartoon");
console.info(`Visual catalog: ${count("cartoon")} cartoons (${cartoons.filter(visual => visual.words).length} with drawn words, ${cartoons.filter(visual => visual.brief).length} with a brief), ${count("diagram")} diagrams, ${count("table")} tables, ${lessons.filter(lesson => lesson.summary).length} lesson summaries`);
