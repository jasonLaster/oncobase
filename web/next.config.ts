import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  async redirects() {
    const wikiRedirects: Record<string, string> = {
      // diagnostics
      diagnosis: "diagnostics/diagnosis",
      "diagnostic-suggestions": "diagnostics/diagnostic-suggestions",
      "predictive-biomarkers": "diagnostics/predictive-biomarkers",
      "molecular-workup": "diagnostics/molecular-workup",
      "day4-biopsy": "diagnostics/day4-biopsy",
      sox10: "diagnostics/sox10",
      "ctdna-mrd": "diagnostics/ctdna-mrd",
      "ctdna-companies": "diagnostics/ctdna-companies",
      // treatment
      "treatment-plan": "treatment/treatment-plan",
      medications: "treatment/medications",
      "Cancer%20Vaccines": "treatment/Cancer%20Vaccines",
      "vaccines-technical": "treatment/vaccines-technical",
      "clinical-trials": "treatment/clinical-trials",
      "metabolic-therapy": "treatment/metabolic-therapy",
      "scalp-cooling": "treatment/scalp-cooling",
      // prognosis
      prognosis: "prognosis/prognosis",
      "survival-statistics": "prognosis/survival-statistics",
      // people
      "medical-team": "people/medical-team",
      "peer-journeys": "people/peer-journeys",
      support: "people/support",
      // research
      "research-review": "research/research-review",
      "research-articles": "research/research-articles",
      "missing-papers": "research/missing-papers",
      // archived
      pregnancy: "archived/pregnancy",
    };

    return Object.entries(wikiRedirects).map(([from, to]) => ({
      source: `/wiki/${from}`,
      destination: `/wiki/${to}`,
      permanent: true,
    }));
  },
  serverExternalPackages: ["gray-matter"],
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
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
