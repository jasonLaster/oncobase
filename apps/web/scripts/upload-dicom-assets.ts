import { createHash } from "crypto";
import { promises as fs } from "fs";
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { sitePut } from "../src/lib/blob";
import { resolveServerConvexUrl } from "../src/lib/convex-url";
import { getDicomCatalog, resolveDicomPath } from "../src/lib/dicom-local";

const SITE_SLUG = process.env.DICOM_SITE_SLUG ?? "diana";
const DRY_RUN = process.argv.includes("--dry-run");

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

  console.log(
    `${DRY_RUN ? "Dry run complete" : "Done"}: ${uploaded} image(s), ${skipped} skipped, root=${catalog.root}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
