import type { Plugin } from "vite";
import type { OutputBundle } from "rolldown";
import { startEarlyRequests } from "../src/bootstrap/early-requests";

/**
 * Whether this document will start the reader. `reader` is the server's own
 * routing decision (rootRouteFor() evaluated by the app shell, stamped as
 * `<html data-reader-start>`); without it (the dev server, a static fallback)
 * this mirrors rootRouteFor() (src/root-route.ts), and
 * reader-preload-plugin.test.ts holds the two together. `access` and `site`
 * are the server's other stamps, readable before the rest of the head is
 * parsed. Self-contained: it is inlined into the document by source.
 */
export function startsReader(hostname: string, pathname: string, access: string | null, site: string | null, reader: string | null = null) {
  if (reader === "true") return true;
  if (reader === "false") return false;
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

/** Start the content requests (early-requests.ts), then download the reader
 * in two classes: the paint-critical modules (shell, article, markdown) now,
 * at high priority, and the store (Effect, LiveStore, workers, SQLite) once
 * those and the entry have arrived, at low priority. Priority alone does not
 * keep the store's ~800 KB off a slow link: requests in flight share it. So
 * the store waits for the paint set, and the article's code gets the whole
 * link. Module preloading does not execute anything or open a database. Keep
 * standalone routes light, and follow only static imports so optional
 * features stay optional. */
function preloadReaderModules(paint: string[], store: string[], reader: typeof startsReader,
  early: (config: { runtime: string[] }) => void, config: { runtime: string[] }) {
  const root = document.documentElement;
  if (!reader(location.hostname, location.pathname, root.getAttribute("data-reader-access"), root.getAttribute("data-wiki-site"),
    root.getAttribute("data-reader-start"))) return;
  try { early(config); } catch { /* The reader sends its own requests. */ }
  if (!document.createElement("link").relList.supports("modulepreload")) return;
  const add = (href: string, priority: "high" | "low", group: string, settled?: () => void) => {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.crossOrigin = "";
    link.href = href;
    link.setAttribute("fetchpriority", priority);
    link.dataset.reader = group;
    if (settled) link.onload = link.onerror = settled;
    document.head.appendChild(link);
  };
  let started = false;
  const startStore = () => {
    if (started) return;
    started = true;
    for (const href of store) add(href, "low", "store");
    try { window.__WIKI_EARLY__?.startRuntime(); } catch { /* The store fetches its runtime itself. */ }
  };
  // The paint set, plus the entry graph and stylesheet (module scripts run,
  // and DOMContentLoaded fires, only after both arrived).
  let waiting = paint.length + 1;
  const settled = () => { if (--waiting === 0) startStore(); };
  document.addEventListener("DOMContentLoaded", settled, { once: true });
  for (const href of paint) add(href, "high", "paint", settled);
}

type Chunk = Extract<OutputBundle[string], { type: "chunk" }>;

/** The reader's two preload classes and the store runtime files, from a built bundle. */
export function readerPreloadSets(bundle: OutputBundle, entryFile: string | undefined) {
  const chunks = Object.values(bundle).filter((value): value is Chunk => value.type === "chunk");
  const chunkFor = (source: string) => {
    const found = chunks.find(value => Object.keys(value.modules).some(id => id.replaceAll("\\", "/").endsWith(source)));
    if (!found) throw new Error(`Cannot locate ${source} for preloading`);
    return found;
  };
  const collect = (file: string, found = new Set<string>()): Set<string> => {
    const item = bundle[file];
    if (!item || item.type !== "chunk" || found.has(file)) return found;
    found.add(file);
    for (const dependency of item.imports) collect(dependency, found);
    return found;
  };
  const entry = entryFile ? collect(entryFile) : new Set<string>();
  // WikiViteRoot statically holds the paint-critical reader (ReaderRoot, App,
  // shell, markdown). StoreHost is the store half it imports after paint.
  const paint = collect(chunkFor("/src/WikiViteRoot.tsx").fileName);
  const store = collect(chunkFor("/src/livestore/StoreHost.tsx").fileName);
  const paintFiles = [...paint].filter(file => !entry.has(file));
  const storeFiles = [...store].filter(file => !entry.has(file) && !paint.has(file));
  const runtime = Object.values(bundle)
    .filter(value => /(?:^|\/)(?:wa-sqlite-[\w-]+\.wasm|livestore\.worker-[\w-]+\.js|make-shared-worker-[\w-]+\.js)$/.test(value.fileName))
    .map(value => value.fileName)
    // Only the SQLite build the worker loads (not the async variant), when both exist.
    .filter(file => !/wa-sqlite-async/.test(file))
    .sort();
  return { entry, paint: paintFiles, store: storeFiles, runtime };
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
        const sets = readerPreloadSets(bundle as unknown as OutputBundle, chunk?.fileName);
        const url = (file: string) => `${base}${file}`;
        const config = { runtime: sets.runtime.map(url) };
        // Prepend: an inline script placed after the stylesheet link waits for
        // the stylesheet to download, which held these preloads until CSS loaded.
        return [{ tag: "script", attrs: { id: "wiki-reader-module-preload" },
          children: `(${preloadReaderModules.toString()})(${JSON.stringify(sets.paint.map(url))},${JSON.stringify(sets.store.map(url))},${startsReader.toString()},${startEarlyRequests.toString()},${JSON.stringify(config)})`,
          injectTo: "head-prepend" }];
      },
    },
  };
}
