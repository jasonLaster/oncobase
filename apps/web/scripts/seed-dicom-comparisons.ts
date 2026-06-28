import "./load-env";

import { promises as fs } from "fs";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { resolveServerConvexUrl } from "../src/lib/convex-url";
import {
  DIAGNOSTIC_COMPARISONS_META_KEY,
  normalizeDiagnosticComparisonsPayload,
  seriesPairsFromSeriesSummary,
  type DiagnosticComparisonsPayload,
  type SeriesSummaryInput,
} from "../src/lib/dicom-comparisons";
import { diagnosticComparisonsSeed } from "./fixtures/diagnostic-comparisons-seed";

const SITE_SLUG = process.env.DICOM_COMPARISONS_SITE_SLUG ?? "diana";
const DEFAULT_COMPARISON_ID = "mri-comparison-2026-04-01-vs-2026-06-26";
const LEFT_STUDY_ID = "diagnostic-2026-04-01-breast-mri";
const RIGHT_STUDY_ID = "diagnostic-2026-06-26-breast-mri";

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: bun run dicom-comparisons:seed [--file comparisons.json | --series-summary series-summary.json]",
    );
    return;
  }

  const source = await loadSource();
  const payload = normalizeDiagnosticComparisonsPayload(source);
  const convexUrl = resolveServerConvexUrl();
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
  }
  const convex = new ConvexHttpClient(convexUrl);

  await convex.mutation(api.documents.setMeta, {
    key: DIAGNOSTIC_COMPARISONS_META_KEY,
    siteSlug: SITE_SLUG,
    value: JSON.stringify(payload),
  });

  const pairCount = payload.comparisons.reduce(
    (total, comparison) => total + comparison.seriesPairs.length,
    0,
  );
  console.log(
    `Seeded DICOM comparisons for site=${SITE_SLUG} with ${payload.comparisons.length} comparisons and ${pairCount} series pairs.`,
  );
}

async function loadSource(): Promise<DiagnosticComparisonsPayload | unknown> {
  const sourceFile = argValue("--file");
  if (sourceFile) return JSON.parse(await fs.readFile(sourceFile, "utf8"));

  const seriesSummaryFile = argValue("--series-summary");
  if (!seriesSummaryFile) return diagnosticComparisonsSeed;

  const summary = JSON.parse(await fs.readFile(seriesSummaryFile, "utf8")) as SeriesSummaryInput;
  return {
    comparisons: [
      {
        id: DEFAULT_COMPARISON_ID,
        label: "April 1 vs June 26 breast MRI",
        leftStudyId: LEFT_STUDY_ID,
        rightStudyId: RIGHT_STUDY_ID,
        modality: "MR",
        bodyPart: "Breast",
        createdAt: new Date().toISOString(),
        sourceArtifacts: [seriesSummaryFile],
        caveat:
          "Computational side-by-side review and clinical context, not a diagnostic radiology report.",
        seriesPairs: seriesPairsFromSeriesSummary(summary, {
          leftStudyId: LEFT_STUDY_ID,
          rightStudyId: RIGHT_STUDY_ID,
        }),
        reportAnchors: [],
        precomputedPanels: [],
      },
    ],
  } satisfies DiagnosticComparisonsPayload;
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
