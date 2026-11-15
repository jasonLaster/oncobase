import type { Plugin } from "vite";

/**
 * Whether this document will start the reader. Mirrors rootRouteFor()
 * (src/root-route.ts); reader-preload-plugin.test.ts holds the two together.
 * `access` and `site` are the server's routing decision, stamped on <html> so
 * they are readable before the rest of the head is parsed. Self-contained: it
 * is inlined into the document by source.
 */
export function startsReader(hostname: string, pathname: string, access: string | null, site: string | null) {
  // The marketing site (oncobase.io) never opens the reader. This pattern is copied from src/site-host.ts.
  if (site === "oncobase" || /(^|\.)oncobase\.(io|localhost)$/.test(hostname)) return false;
  // Signed-out visitors to "/" get the landing page, which paid for the whole reader before this check.
  if (access === "landing" && pathname === "/") return false;
  if (pathname === "/education" || pathname.startsWith("/education/")) return false;
  if (["/login", "/sign-in", "/share", "/terms-and-conditions", "/tools/dicom-viewer", "/tools/dicom-compare", "/tools/pathology-viewer", "/tools/pdf-viewer"].includes(pathname)) return false;
  // An education-only visitor reads lessons and search in the reader; every other path asks for the password.
  if (access === "education" && pathname !== "/search" && !/^\/wiki\/education\/./i.test(pathname)) return false;
  return true;
}

/** Download the inevitable reader modules (session bootstrap and reader
 * shell) while the entry starts. Module
 * preloading does not execute them or open a database. Keep standalone routes
 * light, and follow only static imports so optional features stay optional. */
function preloadReaderModules(urls: string[], reader: typeof startsReader) {
  const root = document.documentElement;
  if (!reader(location.hostname, location.pathname, root.getAttribute("data-reader-access"), root.getAttribute("data-wiki-site"))) return;
  if (!document.createElement("link").relList.supports("modulepreload")) return;
  for (const href of urls) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.crossOrigin = "";
    link.href = href;
    link.dataset.reader = "";
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
        const chunkFor = (source: string) => {
          const found = Object.values(bundle).find(value => value.type === "chunk" && Object.keys(value.modules).some(id => id.replaceAll("\\", "/").endsWith(source)));
          if (!found) throw new Error(`Cannot locate ${source} for preloading`);
          return found;
        };
        // WikiViteRoot (session bootstrap) loads first and then imports
        // LiveStoreRoot; preload both so neither waits on the other.
        const roots = [chunkFor("/src/WikiViteRoot.tsx"), chunkFor("/src/livestore/LiveStoreRoot.tsx")];
        const collect = (file: string, found = new Set<string>()): Set<string> => {
          const item = bundle[file];
          if (!item || item.type !== "chunk" || found.has(file)) return found;
          found.add(file);
          for (const dependency of item.imports) collect(dependency, found);
          return found;
        };
        const entry = chunk ? collect(chunk.fileName) : new Set<string>();
        const reader = new Set<string>();
        for (const root of roots) collect(root.fileName, reader);
        const urls = [...reader].filter(file => !entry.has(file)).map(file => `${base}${file}`);
        // Prepend: an inline script placed after the stylesheet link waits for
        // the stylesheet to download, which held these preloads until CSS loaded.
        return [{ tag: "script", attrs: { id: "wiki-reader-module-preload" },
          children: `(${preloadReaderModules.toString()})(${JSON.stringify(urls)},${startsReader.toString()})`, injectTo: "head-prepend" }];
      },
    },
  };
}
