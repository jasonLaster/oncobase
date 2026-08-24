import { createHash } from "crypto";
import { promises as fs } from "fs";
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { siteHead, sitePut } from "../src/lib/blob";
import { resolveServerConvexUrl } from "../src/lib/convex-url";
import { getDicomCatalog, resolveDicomPath } from "../src/lib/dicom-local";
import {
  DIAGNOSTIC_STUDIES_META_KEY,
  normalizeDiagnosticStudiesPayload,
} from "../src/lib/diagnostic-studies";

const SITE_SLUG = process.env.DICOM_SITE_SLUG ?? "diana";
const DRY_RUN = process.argv.includes("--dry-run");
const STUDIES_FILE = argValue("--studies-file");
const INCLUDE_PREFIX = normalizePrefix(argValue("--include-prefix"));
const ALLOW_OVERWRITE = process.argv.includes("--allow-overwrite");
const RESUME = process.argv.includes("--resume");
const REGISTER_ONLY = process.argv.includes("--register-only");
const UPLOAD_CONCURRENCY = positiveInteger(
  process.env.DICOM_UPLOAD_CONCURRENCY,
  8,
);

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

  let selectedSeries = INCLUDE_PREFIX
    ? catalog.series.filter(
        (series) =>
          series.relativeDirectory === INCLUDE_PREFIX ||
          series.relativeDirectory.startsWith(`${INCLUDE_PREFIX}/`),
      )
    : catalog.series;

  if (INCLUDE_PREFIX && !selectedSeries.length) {
    throw new Error(`No DICOM series matched --include-prefix ${INCLUDE_PREFIX}`);
  }

  let resumedSeries = 0;
  if (RESUME) {
    const existingSeries = await convex.query(api.dicom.listSeries, {
      siteSlug: SITE_SLUG,
    });
    const existingByKey = new Map(
      existingSeries.map((series) => [series.seriesKey, series]),
    );

    selectedSeries = selectedSeries.filter((series) => {
      const existing = existingByKey.get(series.seriesKey);
      if (!existing || existing.images.length !== series.images.length) {
        return true;
      }

      const existingImages = new Map(
        existing.images.map((image) => [image.path, image]),
      );
      const isComplete = series.images.every((image) => {
        const existingImage = existingImages.get(image.relativePath);
        return (
          existingImage &&
          existingImage.sizeBytes === image.byteLength &&
          !existingImage.deletedAt
        );
      });
      if (!isComplete) return true;

      resumedSeries += 1;
      console.log(
        `Resume: skipping ${series.images.length} registered images for ${series.relativeDirectory}`,
      );
      return false;
    });
  }

  for (const series of selectedSeries) {
    const uploadedImages = await mapWithConcurrency(
      series.images,
      UPLOAD_CONCURRENCY,
      async (image) => {
        const resolved = await resolveDicomPath(image.relativePath);
        if (!resolved) {
          skipped += 1;
          return null;
        }

        const body = await fs.readFile(resolved.absolutePath);
        const contentHash = createHash("sha256").update(body).digest("hex");
        const blobKey = `dicom/${image.relativePath}`;

        let blobUrl = `dry-run://${blobKey}`;
        if (!DRY_RUN) {
          if (REGISTER_ONLY) {
            const blob = await siteHead(SITE_SLUG, blobKey);
            if (blob.size !== body.byteLength) {
              throw new Error(
                `Registered Blob size mismatch for ${image.relativePath}: local=${body.byteLength}, remote=${blob.size}`,
              );
            }
            blobUrl = blob.url;
          } else {
            const blob = await sitePut(SITE_SLUG, blobKey, body, {
              addRandomSuffix: false,
              allowOverwrite: ALLOW_OVERWRITE,
              contentType: "application/dicom",
            });
            blobUrl = blob.url;
          }
        }

        uploaded += 1;
        return {
          path: image.relativePath,
          fileName: image.fileName,
          blobUrl,
          sizeBytes: image.byteLength,
          contentHash,
          instanceNumber: image.instanceNumber ?? undefined,
          imagePosition: image.imagePosition ?? undefined,
          rows: image.rows ?? undefined,
          columns: image.columns ?? undefined,
          pixelSpacing: image.pixelSpacing ?? undefined,
        };
      },
    );
    const images = uploadedImages.filter(
      (image): image is NonNullable<typeof image> => image !== null,
    );

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
    `${DRY_RUN ? "Dry run complete" : "Done"}: ${uploaded} image(s), ${skipped} skipped, ${resumedSeries} resumed series, registerOnly=${REGISTER_ONLY}, root=${catalog.root}, prefix=${INCLUDE_PREFIX ?? "all"}`,
  );
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizePrefix(value: string | undefined) {
  const normalized = value?.replace(/^\/+|\/+$/g, "");
  return normalized || undefined;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function mapWithConcurrency<Input, Output>(
  values: Input[],
  concurrency: number,
  worker: (value: Input) => Promise<Output>,
) {
  const results = new Array<Output>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        results[index] = await worker(values[index]);
      }
    }),
  );
  return results;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
