// SPIKE: the app's own Vite config, with entry exports preserved for the SSR build.
import { mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(base, {
  build: { rolldownOptions: { preserveEntrySignatures: "strict" } },
  ssr: { noExternal: process.env.SPIKE_BUNDLE_ALL ? true : undefined },
});
