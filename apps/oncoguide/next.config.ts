import type { NextConfig } from "next";
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@oncobase/wiki-markdown", "@oncobase/wiki-content", "@oncobase/wiki-shell", "@oncobase/education"],
};
export default config;
