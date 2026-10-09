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
// Includes lazy chunks as well as the initial Next.js/React runtime.
if (gzipBytes > 350 * 1024) throw Error(`Client JavaScript exceeds the 350 KiB gzip budget: ${gzipBytes}`);
console.info(`Static export verified: ${pages.length} lessons, ${manifest.assets.length} assets, ${Math.round(gzipBytes / 1024)} KiB gzip JavaScript`);
