/**
 * Sync pdfAssets from prod Convex to dev Convex.
 * Blob URLs are shared — only the Convex records need copying.
 *
 * Usage: bun scripts/sync-convex.ts
 */
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PROD_URL = process.env.NEXT_PUBLIC_CONVEX_URL_PROD;
const DEV_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!PROD_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL_PROD not set in .env.local");
  process.exit(1);
}

if (!DEV_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set in .env.local");
  process.exit(1);
}

if (DEV_URL === PROD_URL) {
  console.log("Dev and prod are the same deployment — nothing to sync.");
  process.exit(0);
}

async function main() {
  const prod = new ConvexHttpClient(PROD_URL!);
  const dev = new ConvexHttpClient(DEV_URL!);

  // Fetch all PDF assets from prod
  const prodAssets = await prod.query(api.documents.listPdfAssets, {});
  console.log(`Prod: ${prodAssets.length} PDF assets`);

  // Fetch existing dev assets to skip duplicates
  const devAssets = await dev.query(api.documents.listPdfAssets, {});
  const devPaths = new Set(devAssets.map((a) => a.path));
  console.log(`Dev:  ${devAssets.length} PDF assets`);

  const toSync = prodAssets.filter((a) => !devPaths.has(a.path));
  console.log(`Syncing ${toSync.length} missing assets...`);

  let synced = 0;
  for (const asset of toSync) {
    await dev.mutation(api.documents.upsertPdfAsset, {
      path: asset.path,
      blobUrl: asset.blobUrl,
      sizeBytes: asset.sizeBytes,
    });
    synced++;
    if (synced % 50 === 0) {
      console.log(`  ${synced}/${toSync.length}...`);
    }
  }

  console.log(`Done! Synced ${synced} PDF assets from prod to dev.`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
