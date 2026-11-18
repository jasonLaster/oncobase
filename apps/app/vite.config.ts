import { fileURLToPath } from "node:url";
import { livestoreDevtoolsPlugin } from "@livestore/devtools-vite";
import {
  assertWikiReaderCacheGenerations,
  WIKI_PREVIOUS_READER_CACHE_VERSION,
  WIKI_READER_CACHE_VERSION,
} from "@oncobase/wiki-content";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { wikiApiPlugin } from "./server/wiki-api.ts";
import { createCommandPaletteChords } from "../../packages/wiki-shell/src/command-palette-chords";
import { installReaderShortcuts } from "./src/bootstrap/reader-shortcuts";
import { readerPreloadPlugin } from "./scripts/reader-preload-plugin";
import { readerBuildMetadataPlugin } from "./scripts/reader-build-metadata";
import { devLandingPlugin } from "./scripts/dev-landing-plugin";
import { pdfAssetsPlugin } from "./scripts/pdf-assets-plugin";

const apiOrigin = process.env.VITE_WIKI_API_ORIGIN ?? "";

function wikiReaderCacheVersionPlugin() {
  assertWikiReaderCacheGenerations();
  return {
    name: "wiki-reader-cache-versions",
    transformIndexHtml(html: string) {
      return html
        .replaceAll(
          "__WIKI_CURRENT_READER_CACHE_VERSION__",
          WIKI_READER_CACHE_VERSION,
        )
        .replaceAll(
          "__WIKI_PREVIOUS_READER_CACHE_VERSION__",
          WIKI_PREVIOUS_READER_CACHE_VERSION,
        );
    },
  };
}

const packagePattern = (names: string[]) => new RegExp(`/node_modules/(?:${names.join("|")})/`);
// The raw-HTML stage: rehype-raw on parse5. It loads only for documents that
// hold HTML (packages/wiki-markdown/src/raw-html.ts).
const RAW_HTML_PACKAGES = packagePattern([
  "rehype-raw", "hast-util-raw", "parse5", "entities", "hast-util-from-parse5", "hast-util-to-parse5",
  "hastscript", "hast-util-parse-selector", "web-namespaces", "html-void-elements",
]);
// Used only by the chat renderer (streamdown) and the math engine: left to
// split with them instead of joining vendor-markdown.
const OFF_PAINT_MARKDOWN_PACKAGES = packagePattern([
  "rehype-harden", "rehype-sanitize", "hast-util-sanitize", "hast-util-to-text", "hast-util-from-dom",
  "hast-util-is-element",
]);

function vendorChunk(id: string): string | null {
  const normalized = id.replace(/\\/g, "/");
  if (
    /node_modules\/(?:@vitejs\/plugin-react|react|react-dom|scheduler)\//.test(normalized) ||
    normalized.includes("react/jsx-runtime") ||
    normalized.includes("react/jsx-dev-runtime")
  ) {
    return "vendor-react";
  }
  if (!normalized.includes("/node_modules/")) return null;
  if (normalized.includes("/node_modules/effect/") || normalized.includes("/node_modules/@effect/")) {
    return "vendor-effect";
  }
  if (normalized.includes("/node_modules/@livestore/")) {
    return "vendor-livestore";
  }
  if (normalized.includes("/node_modules/katex/") || normalized.includes("/node_modules/rehype-katex/")) return "vendor-math";
  // Neither may sit in vendor-markdown, which the article needs before it paints.
  if (RAW_HTML_PACKAGES.test(normalized)) return "vendor-rawhtml";
  if (OFF_PAINT_MARKDOWN_PACKAGES.test(normalized)) return null;
  if (
    normalized.includes("/node_modules/react-markdown/") ||
    normalized.includes("/node_modules/unified/") ||
    normalized.includes("/node_modules/remark-") ||
    normalized.includes("/node_modules/rehype-") ||
    normalized.includes("/node_modules/micromark") ||
    normalized.includes("/node_modules/mdast-util-") ||
    normalized.includes("/node_modules/hast-util-") ||
    normalized.includes("/node_modules/katex/")
  ) {
    return "vendor-markdown";
  }
  if (normalized.includes("/node_modules/lucide-react/")) {
    return "vendor-icons";
  }
  // Cornerstone and its deps split naturally behind the ensureCornerstone
  // dynamic-import boundary; forcing them into one chunk deadlocked module
  // evaluation (same class as the earlier comments chunk bug).
  return null;
}


export default defineConfig({
  optimizeDeps: {
    // Cornerstone's decoder worker statically imports every codec adapter. The
    // codec packages below publish CommonJS/UMD factories behind ESM-style
    // subpath exports; without pre-bundling, Vite's dev server exposes the raw
    // files and the worker fails to link on their missing default exports.
    include: [
      "@cornerstonejs/codec-charls/decodewasmjs",
      "@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
      "@cornerstonejs/codec-openjpeg/decodewasmjs",
      "@cornerstonejs/codec-openjph/wasmjs",
      "jpeg-lossless-decoder-js",
    ],
  },
  build: {
    // Keep all styles in a single entry stylesheet. Per-chunk CSS files are
    // preloaded via `<link rel="stylesheet">` before a lazy chunk executes, and
    // a single failed preload (e.g. a stale/aborted immutable cache entry) takes
    // the whole reader down with "Unable to preload CSS". One eager stylesheet
    // removes that failure mode entirely.
    cssCodeSplit: false,
    rolldownOptions: {
      preserveEntrySignatures: false,
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: true,
          // Keep transitive library dependencies out of application chunks.
          // Priority gives shared React/Effect dependencies a stable owner. Keep
          // every priority positive: a negative one moved React core into vendor-icons.
          // Markdown owns shared helpers ahead of the optional raw-HTML stage
          // and math engine, so neither drags a shared helper off the paint path.
          groups: ["react", "effect", "livestore", "markdown", "rawhtml", "math", "icons"].map((vendor, index) => ({
            name: `vendor-${vendor}`,
            test: (id: string) => vendorChunk(id) === `vendor-${vendor}`,
            priority: 70 - index * 10,
          })),
        },
      },
    },
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60001,
    ...(apiOrigin
      ? {
          proxy: {
            "/api": {
              target: apiOrigin,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
  worker: { format: "es" },
  plugins: [
    pdfAssetsPlugin(),
    {
      // react-router 7 ships dist/production but its package "exports" only
      // name dist/development, so every bundler picks the development build
      // (dev-only warnings and checks, ~14 KiB gzip on the paint path).
      // Production builds resolve the bare specifier to the production file;
      // the dev server keeps the development build and its warnings.
      name: "react-router-production-build",
      config: (_config, { command }) => command === "build"
        ? { resolve: { alias: [{ find: /^react-router$/, replacement: fileURLToPath(new URL("../../node_modules/react-router/dist/production/index.mjs", import.meta.url)) }] } }
        : undefined,
    },
    {
      name: "wiki-reader-startup-shortcuts",
      transformIndexHtml() {
        return [{
          tag: "script",
          attrs: { id: "wiki-reader-shortcuts" },
          children: `(${installReaderShortcuts.toString()})(${createCommandPaletteChords.toString()})`,
          injectTo: "head-prepend" as const,
        }];
      },
    },
    {
      // WebMCP origin trial: one token per production origin (comma-separated).
      // Chrome ignores tokens issued for other origins, so every site's token
      // can ship in the one shared shell.
      name: "webmcp-origin-trial",
      transformIndexHtml() {
        return (process.env.WEBMCP_ORIGIN_TRIAL_TOKENS ?? "")
          .split(",")
          .map((token) => token.trim())
          .filter(Boolean)
          .map((content) => ({
            tag: "meta",
            attrs: { "http-equiv": "origin-trial", content },
            injectTo: "head-prepend" as const,
          }));
      },
    },
    wikiReaderCacheVersionPlugin(),
    readerBuildMetadataPlugin(),
    readerPreloadPlugin(),
    devLandingPlugin(),
    !apiOrigin ? wikiApiPlugin() : null,
    tailwindcss(),
    react(),
    livestoreDevtoolsPlugin({ schemaPath: "./src/livestore/schema.ts" }),
  ],
});
