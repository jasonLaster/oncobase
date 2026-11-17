// SPIKE: a client build of hydrate.html with the app's own plugins and chunking
// (minus the reader's head preload plugin, which expects index.html's graph).
import { mergeConfig, type PluginOption } from "vite";
import base from "../../vite.config";

const plugins = (base.plugins ?? []).flat().filter(plugin =>
  !(plugin && typeof plugin === "object" && "name" in plugin && plugin.name === "wiki-reader-module-preload")) as PluginOption[];

export default mergeConfig({ ...base, plugins }, {
  base: "/",
  build: { outDir: ".spike-client", emptyOutDir: true, target: "es2022", rolldownOptions: { input: "spike/ssr/hydrate.html" } },
});
