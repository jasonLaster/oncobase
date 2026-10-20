import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** PDF.js loads these codecs/fonts on demand, from our own origin. */
export function pdfAssetsPlugin(): Plugin {
  const files = pdfSupportAssetFiles();
  return {
    name: "pdf-viewer-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files.get(request.url?.split("?")[0] ?? "");
        if (!file) return next();
        response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: "asset", fileName: name.slice(1), source: readFileSync(file) });
    },
  };
}

export function pdfSupportAssetFiles() {
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const files = new Map<string, string>();
  for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const name of readdirSync(path.join(root, folder))) {
      if (!/\.(bcmap|pfb|ttf|wasm|icc)$/i.test(name)) continue;
      if (name === "quickjs-eval.wasm") continue;
      files.set(`/pdf-assets/${folder}/${name}`, path.join(root, folder, name));
    }
  }
  return files;
}
