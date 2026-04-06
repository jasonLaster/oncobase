import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingExcludes: {
    "*": [
      "../obsidian/**/*.pdf",
      "../obsidian/**/*.jpg",
      "../obsidian/**/*.jpeg",
      "../obsidian/**/*.png",
      "../obsidian/**/*.gif",
      "../obsidian/**/*.webp",
      "../obsidian/.claude/**",
      "../obsidian/node_modules/**",
      "../obsidian/.obsidian/**",
    ],
  },
};

export default nextConfig;
