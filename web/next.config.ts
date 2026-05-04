import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  cacheComponents: true,
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
      prognosis: "prognosis/Prognostic%20Indicators",
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

    const sourceRedirects: { source: string; destination: string }[] = [
      // 408 → 409: Dirbas biopsy planning call was on 4/9, not 4/8
      {
        source: "/sources/meeting-notes/408---dirbas-biopsy-planning",
        destination: "/sources/meeting-notes/409---dirbas-biopsy-planning",
      },
      {
        source: "/sources/meeting-notes/408---dirbas-biopsy-planning-overview",
        destination:
          "/sources/meeting-notes/409---dirbas-biopsy-planning-overview",
      },
      // Biopsy pages moved into diagnostics/biopsy/ subdirectory
      {
        source: "/wiki/diagnostics/day4-biopsy",
        destination: "/wiki/diagnostics/biopsy/day4-biopsy",
      },
      {
        source: "/wiki/diagnostics/biopsy-vs-infusion-april9",
        destination: "/wiki/diagnostics/biopsy/biopsy-vs-infusion-april9",
      },
      {
        source: "/wiki/diagnostics/biopsy-plan-april10",
        destination: "/wiki/diagnostics/biopsy/biopsy-plan-april10",
      },
      // Prognosis page renamed
      {
        source: "/wiki/prognosis/prognosis",
        destination: "/wiki/prognosis/Prognostic%20Indicators",
      },
      {
        source: "/wiki/prognosis/Prognosis%20Indicators",
        destination: "/wiki/prognosis/Prognostic%20Indicators",
      },
    ];

    return [
      ...Object.entries(wikiRedirects).map(([from, to]) => ({
        source: `/wiki/${from}`,
        destination: `/wiki/${to}`,
        permanent: true as const,
      })),
      ...sourceRedirects.map((r) => ({
        ...r,
        permanent: true as const,
      })),
    ];
  },
  transpilePackages: ["@diana-tnbc/chat", "@diana-tnbc/smart-table"],
  outputFileTracingRoot: path.join(__dirname, ".."),
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default withWorkflow(nextConfig);
