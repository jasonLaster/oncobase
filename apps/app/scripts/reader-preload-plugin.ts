import type { Plugin } from "vite";

/** Download the inevitable reader modules while the entry starts. Module
 * preloading does not execute them or open a database. Keep standalone routes
 * light, and follow only static imports so optional features stay optional. */
function preloadReaderModules(urls: string[]) {
  if (["/login", "/terms-and-conditions", "/tools/dicom-viewer", "/tools/dicom-compare"].includes(location.pathname)) return;
  if (!document.createElement("link").relList.supports("modulepreload")) return;
  for (const href of urls) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.crossOrigin = "";
    link.href = href;
    document.head.appendChild(link);
  }
}

export function readerPreloadPlugin(): Plugin {
  let base = "/";
  return {
    name: "wiki-reader-module-preload",
    apply: "build",
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle, chunk }) {
        if (!bundle) return;
        const reader = Object.values(bundle).find(value => value.type === "chunk" && Object.keys(value.modules).some(id => id.replaceAll("\\", "/").endsWith("/src/livestore/LiveStoreRoot.tsx")));
        if (!reader) throw new Error("Cannot locate the reader module for preloading");
        const collect = (file: string, found = new Set<string>()): Set<string> => {
          const item = bundle[file];
          if (!item || item.type !== "chunk" || found.has(file)) return found;
          found.add(file);
          for (const dependency of item.imports) collect(dependency, found);
          return found;
        };
        const entry = chunk ? collect(chunk.fileName) : new Set<string>();
        const urls = [...collect(reader.fileName)].filter(file => !entry.has(file)).map(file => `${base}${file}`);
        return [{ tag: "script", attrs: { id: "wiki-reader-module-preload" },
          children: `(${preloadReaderModules.toString()})(${JSON.stringify(urls)})`, injectTo: "head" }];
      },
    },
  };
}
