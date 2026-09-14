import { loadEnv, type Plugin } from "vite";
import path from "node:path";

/** Deployment metadata belongs to each HTML response, not immutable JS. */
export function readerBuildMetadataPlugin(): Plugin {
  let commitSha: string | undefined;
  return {
    name: "wiki-reader-build-metadata",
    config(config, { mode }) {
      const env = config.envDir === false
        ? Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("VITE_VERCEL_")))
        : loadEnv(mode, path.resolve(config.root ?? process.cwd(), config.envDir ?? "."), "VITE_VERCEL_");
      // Vite can materialize the complete import.meta.env object for an
      // optional variable lookup. Strip unused deployment-specific values
      // from that object too, while retaining the runtime environment label.
      return { define: Object.fromEntries(Object.keys(env)
        .filter(name => name !== "VITE_VERCEL_ENV")
        .map(name => [`import.meta.env.${name}`, "undefined"])) };
    },
    configResolved(config) {
      const value = config.env.VITE_VERCEL_GIT_COMMIT_SHA;
      commitSha = typeof value === "string" && /^[a-f\d]{40}$/i.test(value) ? value : undefined;
    },
    transformIndexHtml() {
      return commitSha ? [{ tag: "meta", attrs: { name: "wiki-build-commit", content: commitSha }, injectTo: "head" }] : [];
    },
  };
}
