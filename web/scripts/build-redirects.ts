#!/usr/bin/env bun
// Generate web/redirects.json — the canonical list of HTTP redirects served by Next.js.
// Run with: bun web/scripts/build-redirects.ts
import { writeFileSync } from "fs";

type Redirect = { source: string; destination: string };

const wikiRedirects: Record<string, string> = {
  diagnosis: "diagnostics/diagnosis",
  "diagnostic-suggestions": "diagnostics/diagnostic-suggestions",
  "predictive-biomarkers": "diagnostics/predictive-biomarkers",
  "molecular-workup": "diagnostics/molecular-workup",
  "day4-biopsy": "diagnostics/day4-biopsy",
  sox10: "diagnostics/sox10",
  "ctdna-mrd": "diagnostics/ctdna-mrd",
  "ctdna-companies": "diagnostics/ctdna-companies",
  "treatment-plan": "treatment/treatment-plan",
  medications: "treatment/medications",
  "Cancer%20Vaccines": "treatment/Cancer%20Vaccines",
  "vaccines-technical": "treatment/vaccines-technical",
  "clinical-trials": "treatment/clinical-trials",
  "metabolic-therapy": "treatment/metabolic-therapy",
  "scalp-cooling": "treatment/scalp-cooling",
  prognosis: "prognosis/Prognostic%20Indicators",
  "survival-statistics": "prognosis/survival-statistics",
  "medical-team": "people/medical-team",
  "peer-journeys": "people/peer-journeys",
  support: "people/support",
  "research-review": "research/research-review",
  "research-articles": "research/research-articles",
  "missing-papers": "research/missing-papers",
  pregnancy: "archived/pregnancy",
};

// Treatment-advances slugs grouped by their FINAL destination (after the
// 2026-05-15 round-3 reorg that retired the treatment-advances/ folder
// entirely).
const taFinal = {
  // sources/treatment-advances/companies/X → sources/resources/companies/X
  // (After the 2026-05-15 round-4 reorg, reference-only companies live under
  // resources/companies/. Only active partners — echo-immune, PHM, kernis —
  // live in sources/companies/.)
  companies: [
    "10x-atera", "arden-bio", "bulsara-bioworks",
    "eve-bio-drug-target-activity-analysis", "eve-bio-drug-target-activity",
    "gigatime", "gordian-bio", "gt-bio", "histowiz", "inocras-cancervision",
    "manifold-bio", "noetik", "ranata-therapeutics",
    "senti-bio-pipeline", "serova-bio",
    "tempus-predicta-genopredicta-mrd", "valius", "waypoint-bio",
  ],
  // Peers — were briefly classified as companies; sid plus joanie now under
  // sources/people/peers/<name>/.
  peers: {
    sid: ["sid", "sid-data", "sid-presentation"],
    joanie: ["joanie", "joanie-1440"],
  },
  // century-of-bio was a podcast/essay series miscategorized as a company.
  essaysFromCompanies: ["century-of-bio"],
  // sources/treatment-advances/essays-and-podcasts/X → sources/resources/essays-and-podcasts/X
  essays: [
    "ark---multiomics",
    "bessemer-biology-native-data-infrastructure-analysis",
    "bessemer-biology-native-data-infrastructure",
    "drugantibody-design", "precision-oncology-matching",
    "sutton-bitter-footnote-small-molecules",
    "teslo-2026-bureaucracy-blocking-cure-analysis",
    "teslo-2026-bureaucracy-blocking-cure",
  ],
  // The Sid pod was filed under essays-and-podcasts before getting reclassified
  // as peer-shared.
  essaysToSidPeer: [
    "03-28-sid-stranded-technologies-pod-analysis",
    "03-28-sid-stranded-technologies-pod",
  ],
  // sources/treatment-advances/ai-and-platforms/X → sources/resources/ai-and-platforms/X
  ai: [
    "04-20-ai-mrna-vaccine-systems-design",
    "04-20-lilly-kelonia-in-vivo-car-t",
    "04-20-pancreatic-vaccine-kras-access-timeline",
    "05-10-lilly-roche-ai-supercomputers",
  ],
};

const phmBases = [
  "04-16-phm-neoadjuvant-addons-analysis",
  "04-16-phm-neoadjuvant-addons-images",
  "04-16-phm-neoadjuvant-addons-summary",
  "04-16-phm-neoadjuvant-addons",
  "04-20-phm-mopro-wishlist-analysis",
  "04-20-phm-mopro-wishlist",
  "0416-phm-neoadjuvant-addons-summary",
  "0416-phm-neoadjuvant-addons",
  "0420-phm-mopro-wishlist",
  "phm-cancer-care-brochure-analysis",
  "phm-cancer-care-brochure",
];

const sourceRedirects: Redirect[] = [
  { source: "/about/For-Patients", destination: "/about/About" },
  { source: "/wiki/summary", destination: "/about/overview" },
  { source: "/wiki/summary/index", destination: "/about/overview/index" },
  { source: "/wiki/summary/current-status", destination: "/about/overview/current-status" },
  { source: "/wiki/summary/active-workstreams", destination: "/about/overview/active-workstreams" },
  { source: "/wiki/summary/key-context", destination: "/about/overview/key-context" },
  { source: "/wiki/summary/for-experts", destination: "/about/overview/for-experts" },
  { source: "/wiki/summary/for-peers", destination: "/about/overview/for-peers" },
  { source: "/wiki/summary/for-friends-and-family", destination: "/about/overview/for-friends-and-family" },
  { source: "/wiki/summary/test-tracker", destination: "/about/overview/test-tracker" },
  { source: "/sources/meeting-notes/408---dirbas-biopsy-planning", destination: "/sources/meeting-notes/409---dirbas-biopsy-planning" },
  { source: "/sources/meeting-notes/408---dirbas-biopsy-planning-overview", destination: "/sources/meeting-notes/409---dirbas-biopsy-planning-overview" },
  { source: "/wiki/diagnostics/day4-biopsy", destination: "/wiki/diagnostics/biopsy/day4-biopsy" },
  { source: "/wiki/diagnostics/biopsy-vs-infusion-april9", destination: "/wiki/diagnostics/biopsy/biopsy-vs-infusion-april9" },
  { source: "/wiki/diagnostics/biopsy-plan-april10", destination: "/wiki/diagnostics/biopsy/biopsy-plan-april10" },
  { source: "/wiki/prognosis/prognosis", destination: "/wiki/prognosis/Prognostic%20Indicators" },
  { source: "/wiki/prognosis/Prognosis%20Indicators", destination: "/wiki/prognosis/Prognostic%20Indicators" },
  { source: "/wiki/diagnostics/pembro-efficacy", destination: "/wiki/questions/is-pembro-working" },
  { source: "/wiki/diagnostics/hla-b2m-loss-testing", destination: "/wiki/questions/hla-b2m-loss" },
  { source: "/wiki/education/reading-a-tumor/immune-hot-vs-cold", destination: "/wiki/questions/is-tumor-hot" },
  { source: "/wiki/treatment/in-vivo-vaccination", destination: "/wiki/questions/in-vivo-vaccination" },
  { source: "/wiki/treatment/in-vivo-vaccination/index", destination: "/wiki/questions/in-vivo-vaccination/index" },
  { source: "/wiki/treatment/in-vivo-vaccination/current-thinking", destination: "/wiki/questions/in-vivo-vaccination/current-thinking" },
  { source: "/wiki/treatment/in-vivo-vaccination/decision-framework", destination: "/wiki/questions/in-vivo-vaccination/decision-framework" },
  { source: "/wiki/education/designing-a-vaccine/06-leukapheresis-and-tcr-t", destination: "/wiki/questions/should-we-bank-leukopak" },
  { source: "/wiki/diagnostics/biobanking-paths", destination: "/wiki/questions/tissue-and-data-routing" },
  { source: "/wiki/treatment/add-ons-evaluation", destination: "/wiki/questions/k522-add-ons" },
  { source: "/wiki/treatment/pcr-drug-interactions-deep-dive", destination: "/wiki/questions/pembro-drug-interactions" },

  // Source reorg 2026-05-15 — final destinations
  { source: "/wiki/research/:path*", destination: "/sources/research/:path*" },
  // claude went claudes-research → sources/claude/research → sources/research/claude
  { source: "/sources/research/claude-deep-research/:path*", destination: "/sources/research/claude/:path*" },
  { source: "/sources/claude/research/:path*", destination: "/sources/research/claude/:path*" },
  { source: "/sources/claudes-research/:path*", destination: "/sources/research/claude/:path*" },
  { source: "/sources/echo-immune/:path*", destination: "/sources/companies/echo-immune/:path*" },
  { source: "/sources/institutions/:path*", destination: "/sources/people/providers/:path*" },
  { source: "/sources/researchers/:path*", destination: "/sources/people/researchers/:path*" },
  ...[
    "aspria-nct04434040",
    "car-nk-followup",
    "car-nk-trials",
    "sascia-nct04595565",
    "zest-nct05306330",
  ].map((slug) => ({
    source: `/sources/trials/${slug}`,
    destination: `/sources/clinical-trials/trials/${slug}`,
  })),
  { source: "/sources/trials/:path*", destination: "/sources/clinical-trials/:path*" },
  ...[
    "car-nk-cell-therapy",
    "car-t-cell-therapy",
    "i-spy2",
    "immunotherapy-vaccine-trials",
    "in-vivo-nac-vaccine-trials",
  ].map((slug) => ({
    source: `/wiki/treatment/clinical-trials/${slug}`,
    destination: `/sources/clinical-trials/topics/${slug}`,
  })),
  { source: "/wiki/treatment/clinical-trials/registry-2026-05/:path*", destination: "/sources/clinical-trials/catalog/:path*" },
  // clinical-trials/registry-2026-05 renamed to clinical-trials/catalog (2026-05-15 round 4)
  { source: "/sources/clinical-trials/registry-2026-05/:path*", destination: "/sources/clinical-trials/catalog/:path*" },
  // ctg-snapshot folded into the catalog as a resources subdir
  { source: "/sources/clinical-trials/ctg-snapshot-2026-05-11/:path*", destination: "/sources/clinical-trials/catalog/resources/ctg-snapshot-2026-05-11/:path*" },
  // kernis moved from sources/resources/kernis → sources/companies/kernis
  { source: "/sources/resources/kernis/:path*", destination: "/sources/companies/kernis/:path*" },
  { source: "/sources/kernis/:path*", destination: "/sources/companies/kernis/:path*" },
  { source: "/sources/research-articles/:path*", destination: "/sources/research/papers/:path*" },
  { source: "/sources/research-guidelines/:path*", destination: "/sources/research/open-evidence/:path*" },
  { source: "/sources/research-catalog/:path*", destination: "/sources/people/researchers/:path*" },
  ...[
    "oe---dana-farber-tnbc-literature-review",
    "oe---mdanderson-tnbc-literature-review",
    "oe---mskcc-tnbc-research-papers",
    "oe---stanford-ai-precision-oncology-raw",
    "oe---stanford-ai-precision-oncology",
    "oe---stanford-tnbc-literature-review",
    "oe---ucsf-keynote522-research",
  ].map((slug) => ({
    source: `/sources/research-analyses/${slug}`,
    destination: `/sources/research/open-evidence/${slug}`,
  })),
  ...[
    "elicit---dana-farber-tnbc-research",
    "elicit-2026-05-08-sweep",
    "elicit-2026-05-08-sweep-pt2",
    "elicit-2026-05-11-leukopak-timing",
    "elicit-ablation-checkpoint-insitu-vaccination-2026-04-13",
    "elicit-adjuvant-decision-tree-2x2-analysis",
    "elicit-adjuvant-decision-tree-2x2",
    "elicit-biopsy-timing-day7-11-analysis",
    "elicit-biopsy-timing-day7-11",
    "elicit-in-vivo-vaccination",
    "elicit-tnbc-vaccine",
  ].flatMap((slug) => [
    { source: `/sources/research-analyses/${slug}`, destination: `/sources/research/elicit/${slug}` },
    { source: `/sources/research-analyses/${slug}/:path*`, destination: `/sources/research/elicit/${slug}/:path*` },
  ]),
  { source: "/sources/research-analyses/md-anderson-faculty", destination: "/sources/research/faculty/md-anderson-faculty" },
  { source: "/sources/research-analyses/msk-faculty", destination: "/sources/research/faculty/msk-faculty" },
  { source: "/sources/research-analyses/:path*", destination: "/sources/research/syntheses/:path*" },

  // treatment-advances: pre-bucketed flat URLs AND companies/essays/ai
  // bucketed URLs both redirect to their final 2026-05-15 destinations.
  ...taFinal.companies.flatMap((slug) => [
    { source: `/sources/treatment-advances/${slug}`, destination: `/sources/resources/companies/${slug}` },
    { source: `/sources/treatment-advances/${slug}/:path*`, destination: `/sources/resources/companies/${slug}/:path*` },
    { source: `/sources/treatment-advances/companies/${slug}`, destination: `/sources/resources/companies/${slug}` },
    { source: `/sources/treatment-advances/companies/${slug}/:path*`, destination: `/sources/resources/companies/${slug}/:path*` },
    // Short-lived intermediate location during round 3 before companies/ was
    // restricted to active partners.
    { source: `/sources/companies/${slug}`, destination: `/sources/resources/companies/${slug}` },
    { source: `/sources/companies/${slug}/:path*`, destination: `/sources/resources/companies/${slug}/:path*` },
  ]),
  ...Object.entries(taFinal.peers).flatMap(([peer, slugs]) =>
    slugs.flatMap((slug) => [
      { source: `/sources/treatment-advances/${slug}`, destination: `/sources/people/peers/${peer}/${slug}` },
      { source: `/sources/treatment-advances/${slug}/:path*`, destination: `/sources/people/peers/${peer}/${slug}/:path*` },
      { source: `/sources/treatment-advances/companies/${slug}`, destination: `/sources/people/peers/${peer}/${slug}` },
      { source: `/sources/treatment-advances/companies/${slug}/:path*`, destination: `/sources/people/peers/${peer}/${slug}/:path*` },
    ]),
  ),
  ...taFinal.essaysFromCompanies.flatMap((slug) => [
    { source: `/sources/treatment-advances/${slug}`, destination: `/sources/resources/essays-and-podcasts/${slug}` },
    { source: `/sources/treatment-advances/${slug}/:path*`, destination: `/sources/resources/essays-and-podcasts/${slug}/:path*` },
    { source: `/sources/treatment-advances/companies/${slug}`, destination: `/sources/resources/essays-and-podcasts/${slug}` },
    { source: `/sources/treatment-advances/companies/${slug}/:path*`, destination: `/sources/resources/essays-and-podcasts/${slug}/:path*` },
  ]),
  ...taFinal.essays.flatMap((slug) => [
    { source: `/sources/treatment-advances/${slug}`, destination: `/sources/resources/essays-and-podcasts/${slug}` },
    { source: `/sources/treatment-advances/${slug}/:path*`, destination: `/sources/resources/essays-and-podcasts/${slug}/:path*` },
    { source: `/sources/treatment-advances/essays-and-podcasts/${slug}`, destination: `/sources/resources/essays-and-podcasts/${slug}` },
    { source: `/sources/treatment-advances/essays-and-podcasts/${slug}/:path*`, destination: `/sources/resources/essays-and-podcasts/${slug}/:path*` },
  ]),
  ...taFinal.essaysToSidPeer.flatMap((slug) => [
    { source: `/sources/treatment-advances/${slug}`, destination: `/sources/people/peers/sid/${slug}` },
    { source: `/sources/treatment-advances/${slug}/:path*`, destination: `/sources/people/peers/sid/${slug}/:path*` },
    { source: `/sources/treatment-advances/essays-and-podcasts/${slug}`, destination: `/sources/people/peers/sid/${slug}` },
    { source: `/sources/treatment-advances/essays-and-podcasts/${slug}/:path*`, destination: `/sources/people/peers/sid/${slug}/:path*` },
  ]),
  ...taFinal.ai.flatMap((slug) => [
    { source: `/sources/treatment-advances/${slug}`, destination: `/sources/resources/ai-and-platforms/${slug}` },
    { source: `/sources/treatment-advances/${slug}/:path*`, destination: `/sources/resources/ai-and-platforms/${slug}/:path*` },
    { source: `/sources/treatment-advances/ai-and-platforms/${slug}`, destination: `/sources/resources/ai-and-platforms/${slug}` },
    { source: `/sources/treatment-advances/ai-and-platforms/${slug}/:path*`, destination: `/sources/resources/ai-and-platforms/${slug}/:path*` },
  ]),

  // PHM resources moved into sources/companies/private-health-management/
  ...phmBases.flatMap((slug) => [
    { source: `/sources/resources/${slug}`, destination: `/sources/companies/private-health-management/${slug}` },
    { source: `/sources/resources/${slug}/:path*`, destination: `/sources/companies/private-health-management/${slug}/:path*` },
  ]),

  { source: "/wiki/active-questions", destination: "/wiki/questions" },
  { source: "/wiki/active-questions/index", destination: "/wiki/questions/index" },
  { source: "/wiki/active-questions/is-pembro-working", destination: "/wiki/questions/is-pembro-working" },
  { source: "/wiki/active-questions/hla-b2m-loss", destination: "/wiki/questions/hla-b2m-loss" },
  { source: "/wiki/active-questions/is-tumor-hot", destination: "/wiki/questions/is-tumor-hot" },
  { source: "/wiki/active-questions/in-vivo-vaccination", destination: "/wiki/questions/in-vivo-vaccination" },
  { source: "/wiki/active-questions/in-vivo-vaccination/index", destination: "/wiki/questions/in-vivo-vaccination/index" },
  { source: "/wiki/active-questions/in-vivo-vaccination/current-thinking", destination: "/wiki/questions/in-vivo-vaccination/current-thinking" },
  { source: "/wiki/active-questions/in-vivo-vaccination/decision-framework", destination: "/wiki/questions/in-vivo-vaccination/decision-framework" },
  { source: "/wiki/active-questions/should-we-bank-leukopak", destination: "/wiki/questions/should-we-bank-leukopak" },
  { source: "/wiki/active-questions/tissue-and-data-routing", destination: "/wiki/questions/tissue-and-data-routing" },
  { source: "/wiki/active-questions/k522-add-ons", destination: "/wiki/questions/k522-add-ons" },
  { source: "/wiki/active-questions/pembro-drug-interactions", destination: "/wiki/questions/pembro-drug-interactions" },
];

const all = [
  ...Object.entries(wikiRedirects).map(([from, to]) => ({
    source: `/wiki/${from}`,
    destination: `/wiki/${to}`,
    permanent: true as const,
  })),
  ...sourceRedirects.map((r) => ({ ...r, permanent: true as const })),
];

writeFileSync(new URL("../redirects.json", import.meta.url), JSON.stringify(all, null, 2) + "\n");
console.log(`Wrote ${all.length} redirects to web/redirects.json`);
