import "./load-env";

import { promises as fs } from "fs";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { resolveServerConvexUrl } from "../src/lib/convex-url";
import {
  DIAGNOSTIC_STUDIES_META_KEY,
  normalizeDiagnosticStudiesPayload,
} from "../src/lib/diagnostic-studies";
import { diagnosticStudiesSeed } from "./fixtures/diagnostic-studies-seed";

const SITE_SLUG = process.env.DIAGNOSTIC_STUDIES_SITE_SLUG ?? "diana";

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: bun run diagnostic-studies:seed [--file path/to/diagnostic-studies.json]",
    );
    return;
  }

  const sourceFile = argValue("--file");
  const source = sourceFile
    ? JSON.parse(await fs.readFile(sourceFile, "utf8"))
    : diagnosticStudiesSeed;
  const payload = normalizeDiagnosticStudiesPayload(source);
  const convexUrl = resolveServerConvexUrl();
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
  }
  const convex = new ConvexHttpClient(convexUrl);

  await convex.mutation(api.documents.setMeta, {
    key: DIAGNOSTIC_STUDIES_META_KEY,
    siteSlug: SITE_SLUG,
    value: JSON.stringify(payload),
  });

  console.log(
    `Seeded diagnostic studies for site=${SITE_SLUG} with ${payload.studies.length} studies.`,
  );
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
