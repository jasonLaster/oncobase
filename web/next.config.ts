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
      // For-Patients page folded into About
      {
        source: "/about/For-Patients",
        destination: "/about/About",
      },
      // wiki/summary/ moved to about/overview/
      {
        source: "/wiki/summary",
        destination: "/about/overview",
      },
      {
        source: "/wiki/summary/index",
        destination: "/about/overview/index",
      },
      {
        source: "/wiki/summary/current-status",
        destination: "/about/overview/current-status",
      },
      {
        source: "/wiki/summary/active-workstreams",
        destination: "/about/overview/active-workstreams",
      },
      {
        source: "/wiki/summary/key-context",
        destination: "/about/overview/key-context",
      },
      {
        source: "/wiki/summary/for-experts",
        destination: "/about/overview/for-experts",
      },
      {
        source: "/wiki/summary/for-peers",
        destination: "/about/overview/for-peers",
      },
      {
        source: "/wiki/summary/for-friends-and-family",
        destination: "/about/overview/for-friends-and-family",
      },
      {
        source: "/wiki/summary/test-tracker",
        destination: "/about/overview/test-tracker",
      },
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
      // Question pages moved out of diagnostics / treatment / education
      {
        source: "/wiki/diagnostics/pembro-efficacy",
        destination: "/wiki/questions/is-pembro-working",
      },
      {
        source: "/wiki/diagnostics/hla-b2m-loss-testing",
        destination: "/wiki/questions/hla-b2m-loss",
      },
      {
        source: "/wiki/education/reading-a-tumor/immune-hot-vs-cold",
        destination: "/wiki/questions/is-tumor-hot",
      },
      {
        source: "/wiki/treatment/in-vivo-vaccination",
        destination: "/wiki/questions/in-vivo-vaccination",
      },
      {
        source: "/wiki/treatment/in-vivo-vaccination/index",
        destination: "/wiki/questions/in-vivo-vaccination/index",
      },
      {
        source: "/wiki/treatment/in-vivo-vaccination/current-thinking",
        destination: "/wiki/questions/in-vivo-vaccination/current-thinking",
      },
      {
        source: "/wiki/treatment/in-vivo-vaccination/decision-framework",
        destination:
          "/wiki/questions/in-vivo-vaccination/decision-framework",
      },
      {
        source: "/wiki/education/designing-a-vaccine/06-leukapheresis-and-tcr-t",
        destination: "/wiki/questions/should-we-bank-leukopak",
      },
      {
        source: "/wiki/diagnostics/biobanking-paths",
        destination: "/wiki/questions/tissue-and-data-routing",
      },
      {
        source: "/wiki/treatment/add-ons-evaluation",
        destination: "/wiki/questions/k522-add-ons",
      },
      {
        source: "/wiki/treatment/pcr-drug-interactions-deep-dive",
        destination: "/wiki/questions/pembro-drug-interactions",
      },
      // active-questions was the short-lived name for the questions layer
      {
        source: "/wiki/active-questions",
        destination: "/wiki/questions",
      },
      {
        source: "/wiki/active-questions/index",
        destination: "/wiki/questions/index",
      },
      {
        source: "/wiki/active-questions/is-pembro-working",
        destination: "/wiki/questions/is-pembro-working",
      },
      {
        source: "/wiki/active-questions/hla-b2m-loss",
        destination: "/wiki/questions/hla-b2m-loss",
      },
      {
        source: "/wiki/active-questions/is-tumor-hot",
        destination: "/wiki/questions/is-tumor-hot",
      },
      {
        source: "/wiki/active-questions/in-vivo-vaccination",
        destination: "/wiki/questions/in-vivo-vaccination",
      },
      {
        source: "/wiki/active-questions/in-vivo-vaccination/index",
        destination: "/wiki/questions/in-vivo-vaccination/index",
      },
      {
        source: "/wiki/active-questions/in-vivo-vaccination/current-thinking",
        destination: "/wiki/questions/in-vivo-vaccination/current-thinking",
      },
      {
        source: "/wiki/active-questions/in-vivo-vaccination/decision-framework",
        destination: "/wiki/questions/in-vivo-vaccination/decision-framework",
      },
      {
        source: "/wiki/active-questions/should-we-bank-leukopak",
        destination: "/wiki/questions/should-we-bank-leukopak",
      },
      {
        source: "/wiki/active-questions/tissue-and-data-routing",
        destination: "/wiki/questions/tissue-and-data-routing",
      },
      {
        source: "/wiki/active-questions/k522-add-ons",
        destination: "/wiki/questions/k522-add-ons",
      },
      {
        source: "/wiki/active-questions/pembro-drug-interactions",
        destination: "/wiki/questions/pembro-drug-interactions",
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
