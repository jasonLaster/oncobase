import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
import path from "path";
import redirects from "./redirects.json";

const nextConfig: NextConfig = {
  cacheComponents: true,
  async redirects() {
    return redirects;
  },
  transpilePackages: [
    "@oncobase/chat",
    "@oncobase/smart-table",
    "@oncobase/wiki-markdown",
  ],
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  experimental: {
    // Keep Vercel builds below the default 8 GB machine ceiling while the
    // document route relies on on-demand rendering for most wiki pages.
    cpus: 1,
    staticGenerationMaxConcurrency: 2,
    staticGenerationMinPagesPerWorker: 100,
  },
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default withWorkflow(nextConfig);
