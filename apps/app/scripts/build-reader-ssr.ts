import { fileURLToPath } from "node:url";
import { build } from "vite";
import { READER_SSR_DIR, READER_SSR_ENTRY } from "./reader-server-budget";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * Builds src/server-entry.tsx (the reader's first frame rendered on the
 * server) with the app's own Vite config, so `import.meta.env`, plugins and
 * module resolution match the client build. Everything is bundled, for a
 * function without node_modules. Nothing imports the output yet: a response
 * would load it lazily (`import()`), so it stays out of the HTML handler's
 * startup budget and has its own (reader-server-budget.ts).
 */
export async function buildReaderSsr(outDir: string) {
  await build({
    configFile: `${appDir}/vite.config.ts`,
    root: appDir,
    mode: "production",
    logLevel: "warn",
    publicDir: false,
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: "src/server-entry.tsx",
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: true,
      sourcemap: false,
      rolldownOptions: {
        // The app's client build drops entry exports (preserveEntrySignatures: false).
        preserveEntrySignatures: "strict",
        output: { entryFileNames: READER_SSR_ENTRY, chunkFileNames: "[name]-[hash].js", format: "es" },
      },
    },
  });
}

if (import.meta.main) {
  await buildReaderSsr(process.argv[2] ?? `${appDir}/.vercel-functions/${READER_SSR_DIR}`);
}
