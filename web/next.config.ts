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
    "@diana-tnbc/chat",
    "@diana-tnbc/smart-table",
    "@diana-tnbc/wiki-markdown",
  ],
  outputFileTracingRoot: path.join(__dirname, ".."),
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default withWorkflow(nextConfig);
