import { livestoreDevtoolsPlugin } from "@livestore/devtools-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { wikiApiPlugin } from "./server/wiki-api";

const apiOrigin = process.env.VITE_WIKI_API_ORIGIN ?? "";

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
  return null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // WIKI_VITE_FORCE_COMMENTS_OFF lets tooling (the e2e web server) pin comments
  // off deterministically. It is NOT set in .env.local, so bun's env-file load
  // cannot clobber it the way it overrides NEXT_PUBLIC_ENABLE_COMMENTS.
  const commentsFlag =
    process.env.WIKI_VITE_FORCE_COMMENTS_OFF === "1"
      ? "false"
      : env.NEXT_PUBLIC_ENABLE_COMMENTS ?? process.env.NEXT_PUBLIC_ENABLE_COMMENTS ?? "";
  return {
  // The shared comments package reads these at module load; Vite has no
  // process.env in the browser bundle, so define them from the loaded env.
  define: {
    "process.env.NEXT_PUBLIC_ENABLE_COMMENTS": JSON.stringify(commentsFlag),
    "process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY": JSON.stringify(
      env.LIVEBLOCKS_PUBLIC_KEY ?? env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? "",
    ),
    __WIKI_COMMENTS_ENABLED__: JSON.stringify(commentsFlag === "true"),
  },
  build: {
    // Keep all styles in a single entry stylesheet. Per-chunk CSS files are
    // preloaded via `<link rel="stylesheet">` before a lazy chunk executes, and
    // a single failed preload (e.g. a stale/aborted immutable cache entry) takes
    // the whole reader down with "Unable to preload CSS". One eager stylesheet
    // removes that failure mode entirely.
    cssCodeSplit: false,
    modulePreload: {
      resolveDependencies(filename, deps) {
        if (filename.includes("LiveStoreRoot") || filename.includes("WikiPage")) {
          return [];
        }
        return deps;
      },
    },
    rolldownOptions: {
      preserveEntrySignatures: false,
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: vendorChunk,
              test: (id) => vendorChunk(id) != null,
              priority: 10,
            },
          ],
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
    !apiOrigin ? wikiApiPlugin() : null,
    tailwindcss(),
    react(),
    livestoreDevtoolsPlugin({ schemaPath: "./src/livestore/schema.ts" }),
  ],
  };
});
