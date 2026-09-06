import { readdirSync } from "node:fs";
import path from "node:path";

// This legacy checkout predates the apps/app guard. Next's proxy exempts
// static file extensions from the password gate, so public/ must contain
// only reviewed application assets. Reader reports belong in gated routes.
const PUBLIC_FILES = new Set([
  "auth-wiki-cartoon-dark.png",
  "auth-wiki-cartoon-light.png",
  "favicon-dev.ico",
  "favicon-dev.svg",
  "favicon.svg",
  "file.svg",
  "globe.svg",
  "next.svg",
  "robots.txt",
  "sw.js",
  "vercel.svg",
  "window.svg",
]);

export function assertPublicAssets(directory: string) {
  const unexpected = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.isFile() || !PUBLIC_FILES.has(entry.name))
    .map((entry) => path.join(directory, entry.name));
  if (unexpected.length) {
    throw new Error(
      `Unapproved anonymous public assets: ${unexpected.join(", ")}. Reader documents must use authenticated content routes.`,
    );
  }
}
