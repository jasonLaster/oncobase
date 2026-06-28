import { createHash } from "crypto";
import { promises as fs } from "fs";
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { sitePut } from "../src/lib/blob";
import { resolveServerConvexUrl } from "../src/lib/convex-url";
import { getDicomCatalog, resolveDicomPath } from "../src/lib/dicom-local";
import {
  DIAGNOSTIC_STUDIES_META_KEY,
  normalizeDiagnosticStudiesPayload,
} from "../src/lib/diagnostic-studies";

const SITE_SLUG = process.env.DICOM_SITE_SLUG ?? "diana";
const DRY_RUN = process.argv.includes("--dry-run");
const STUDIES_FILE = argValue("--studies-file");

const convexUrl = resolveServerConvexUrl();
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
}

const convex = new ConvexHttpClient(convexUrl);

async function main() {
  const catalog = await getDicomCatalog();
  if (!catalog.root) {
    throw new Error(`No diagnostics root found. Tried: ${catalog.rootsTried.join(", ")}`);
  }

  let uploaded = 0;
  let skipped = 0;

  for (const series of catalog.series) {
    const images = [];

    for (const image of series.images) {
      const resolved = await resolveDicomPath(image.relativePath);
      if (!resolved) {
        skipped += 1;
        continue;
      }

      const body = await fs.readFile(resolved.absolutePath);
      const contentHash = createHash("sha256").update(body).digest("hex");
      const blobKey = `dicom/${image.relativePath}`;

      let blobUrl = `dry-run://${blobKey}`;
      if (!DRY_RUN) {
        const blob = await sitePut(SITE_SLUG, blobKey, body, {
          addRandomSuffix: false,
          contentType: "application/dicom",
        });
        blobUrl = blob.url;
      }

      images.push({
        path: image.relativePath,
        fileName: image.fileName,
        blobUrl,
        sizeBytes: image.byteLength,
        contentHash,
        instanceNumber: image.instanceNumber ?? undefined,
        imagePosition: image.imagePosition ?? undefined,
        rows: image.rows ?? undefined,
        columns: image.columns ?? undefined,
      });
      uploaded += 1;
    }

    if (!images.length) continue;

    if (!DRY_RUN) {
      await convex.mutation(api.dicom.upsertSeriesWithImages, {
        siteSlug: SITE_SLUG,
        series: {
          seriesKey: series.seriesKey,
          label: series.label,
          relativeDirectory: series.relativeDirectory,
          modality: series.modality ?? undefined,
          studyDescription: series.studyDescription ?? undefined,
          seriesDescription: series.seriesDescription ?? undefined,
          studyDate: series.studyDate ?? undefined,
          seriesNumber: series.seriesNumber ?? undefined,
        },
        images,
      });
    }

    console.log(
      `${DRY_RUN ? "Would upload" : "Uploaded"} ${images.length} images for ${series.relativeDirectory}`,
    );
  }

  if (STUDIES_FILE) {
    const source = JSON.parse(await fs.readFile(STUDIES_FILE, "utf8"));
    const payload = normalizeDiagnosticStudiesPayload(source);
    if (!DRY_RUN) {
      await convex.mutation(api.documents.setMeta, {
        key: DIAGNOSTIC_STUDIES_META_KEY,
        siteSlug: SITE_SLUG,
        value: JSON.stringify(payload),
      });
    }
    console.log(
      `${DRY_RUN ? "Would seed" : "Seeded"} ${payload.studies.length} diagnostic study metadata rows from ${STUDIES_FILE}`,
    );
  }

  console.log(
    `${DRY_RUN ? "Dry run complete" : "Done"}: ${uploaded} image(s), ${skipped} skipped, root=${catalog.root}`,
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
