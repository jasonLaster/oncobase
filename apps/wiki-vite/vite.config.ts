import { livestoreDevtoolsPlugin } from "@livestore/devtools-vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = process.env.VITE_WIKI_API_ORIGIN ?? "http://localhost:3000";

function vendorChunk(id: string): string | null {
  const normalized = id.replaceAll("\\", "/");
  if (
    /node_modules\/(?:@vitejs\/plugin-react|react|react-dom|scheduler)\//.test(normalized) ||
    normalized.includes("react/jsx-runtime") ||
    normalized.includes("react/jsx-dev-runtime")
  ) {
    return "vendor-react";
  }
  if (!normalized.includes("/node_modules/")) return;
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

export default defineConfig({
  build: {
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
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  worker: { format: "es" },
  plugins: [react(), livestoreDevtoolsPlugin({ schemaPath: "./src/livestore/schema.ts" })],
});
