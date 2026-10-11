import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { educationHref, type GuidePage } from "../lib/routes";

const pages = JSON.parse(fs.readFileSync(".generated/pages.json", "utf8")) as GuidePage[];
const manifest = JSON.parse(fs.readFileSync("out/education-manifest.json", "utf8")) as { assets: string[] };
for (const page of pages) {
  const route = educationHref(page.slug);
  for (const prefix of ["", "/wiki"]) {
    const routes = [route, ...(route.endsWith("/index") ? [route.slice(0, -6)] : [])];
    for (const alias of routes) {
      const file = path.join("out", `${prefix}${alias}`, "index.html");
      if (!fs.existsSync(file)) throw Error(`Missing static lesson: ${file}`);
    }
  }
  if (/src="[^"]*(?:\/api\/|diana-tnbc\.com|blob\.vercel-storage\.com)/.test(page.html)) {
    throw Error(`Remote Diana image dependency: ${page.slug}`);
  }
}
for (const asset of manifest.assets) {
  if (!fs.existsSync(path.join("out", asset))) throw Error(`Missing exported asset: ${asset}`);
}
const chunks = fs.readdirSync("out/_next/static/chunks").filter(file => file.endsWith(".js"));
let gzipBytes = 0;
for (const chunk of chunks) {
  const bytes = fs.readFileSync(path.join("out/_next/static/chunks", chunk));
  gzipBytes += gzipSync(bytes).length;
  if (/convex\.cloud|api\/diagnostic-studies|api\/chat\/|liveblocks\.io/.test(bytes.toString())) {
    throw Error(`Care runtime in client bundle: ${chunk}`);
  }
}
// The shared chat SDK and streaming Markdown load only on the chat route.
// Keep the initial reader ceiling and bound all chunks, including learning chat.
const chunkSizes = new Map(chunks.map(chunk => [chunk, gzipSync(fs.readFileSync(path.join("out/_next/static/chunks", chunk))).length]));
const readerRoutes = ["out/index.html", ...pages.map(page => path.join("out", educationHref(page.slug), "index.html"))];
const initialBytes = Math.max(...readerRoutes.map(file => {
  const initialChunks = new Set([...fs.readFileSync(file, "utf8").matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(match => path.basename(match[1]!)));
  return [...initialChunks].reduce((sum, chunk) => sum + chunkSizes.get(chunk)!, 0);
}));
if (initialBytes > 350 * 1024) throw Error(`Initial reader JavaScript exceeds 350 KiB gzip: ${initialBytes}`);
if (gzipBytes > 550 * 1024) throw Error(`Client JavaScript including lazy learning chat exceeds 550 KiB gzip: ${gzipBytes}`);
console.info(`Static export verified: ${pages.length} lessons, ${manifest.assets.length} assets, ${Math.round(gzipBytes / 1024)} KiB gzip JavaScript (${Math.round(initialBytes / 1024)} KiB maximum initial reader)`);
