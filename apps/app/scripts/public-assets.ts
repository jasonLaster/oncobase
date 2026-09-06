import { readdirSync } from "node:fs";
import path from "node:path";

// Vercel serves static files before the authentication catch-all. Every file
// here is deliberately anonymous; adding a new one requires explicit review.
const PUBLIC_FILES = new Set([
  "auth-wiki-cartoon-dark.png",
  "auth-wiki-cartoon-light.png",
  "favicon.svg",
  "robots.txt",
]);

function files(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`Public assets cannot contain symbolic links: ${relative}`);
    }
    if (entry.isDirectory()) return files(path.join(directory, entry.name), `${relative}/`);
    if (!entry.isFile()) throw new Error(`Unexpected public asset type: ${relative}`);
    return [relative];
  });
}

export function assertPublicAssets(directory: string) {
  const unexpected = files(directory).filter((file) => !PUBLIC_FILES.has(file));
  if (unexpected.length) {
    throw new Error(`Unapproved anonymous public assets: ${unexpected.join(", ")}. Reader documents must use authenticated content routes.`);
  }
}

export function assertBuildAssets(directory: string) {
  const unexpected = files(directory).filter((file) => {
    // The one SPA entry is embedded into the gated function and removed from
    // Vercel's static output by build-vercel-functions.ts.
    if (file === "index.html" || PUBLIC_FILES.has(file)) return false;
    return !file.startsWith("assets/") || /\.(?:html?|xhtml)$/i.test(file);
  });
  if (unexpected.length) {
    throw new Error(`Unapproved static build output: ${unexpected.join(", ")}`);
  }
}
