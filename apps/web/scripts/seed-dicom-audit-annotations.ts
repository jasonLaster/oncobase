import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { resolveServerConvexUrl } from "../src/lib/convex-url";

const SITE_SLUG = process.env.DICOM_SITE_SLUG ?? "diana";
const WRITE = process.argv.includes("--write");

const auditRulers = [
  {
    id: "audit-june-focus-prior-8",
    text: "June report-anchored prior 8 mm focus",
    seriesKey: "2.25.92441482697318590819609109145265512417",
    fileName: "06-26-breast-mri-4165-MR.dcm",
    x: 432.1 / 512,
    y: 180.6 / 512,
    endX: 438.6 / 512,
    endY: 190.3 / 512,
    worldStart: [-118.6918, 98.737, -8.4855],
    worldEnd: [-122.8846, 92.2204, -8.4855],
  },
  {
    id: "audit-july-focus-current-5",
    text: "July report-anchored 5 mm focus",
    seriesKey: "2.25.125273068617921823323029632359324909118",
    fileName: "07-17-breast-mri-04307-mr.dcm",
    x: 411.3 / 512,
    y: 187.1 / 512,
    endX: 415.1 / 512,
    endY: 191.6 / 512,
    worldStart: [-105.9308, 79.5184, -20.0192],
    worldEnd: [-108.6279, 76.4117, -20.0192],
  },
  {
    id: "audit-june-focus-prior-11",
    text: "June report-anchored prior 11 mm focus",
    seriesKey: "2.25.92441482697318590819609109145265512417",
    fileName: "06-26-breast-mri-4174-MR.dcm",
    x: 406.8 / 512,
    y: 222.1 / 512,
    endX: 419.2 / 512,
    endY: 232.9 / 512,
    worldStart: [-101.1802, 69.6905, -15.6855],
    worldEnd: [-109.8763, 62.0619, -15.6855],
  },
  {
    id: "audit-july-focus-current-9",
    text: "July report-anchored 9 mm focus",
    seriesKey: "2.25.125273068617921823323029632359324909118",
    fileName: "07-17-breast-mri-04316-mr.dcm",
    x: 403.8 / 512,
    y: 206.5 / 512,
    endX: 414.1 / 512,
    endY: 214.3 / 512,
    worldStart: [-100.6305, 65.9191, -27.2192],
    worldEnd: [-107.8702, 60.4557, -27.2192],
  },
] as const;

async function main() {
  const convexUrl = resolveServerConvexUrl();
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
  }
  const convex = new ConvexHttpClient(convexUrl);
  const series = await convex.query(api.dicom.listSeries, {
    siteSlug: SITE_SLUG,
    includeImages: false,
  });
  const imagesBySeries = new Map(
    await Promise.all(
      [...new Set(auditRulers.map((ruler) => ruler.seriesKey))].map(
        async (seriesKey) => [
          seriesKey,
          await convex.query(api.dicom.listSeriesImages, {
            siteSlug: SITE_SLUG,
            seriesKey,
          }),
        ] as const,
      ),
    ),
  );

  for (const ruler of auditRulers) {
    const seriesRow = series.find(
      (candidate) => candidate.seriesKey === ruler.seriesKey,
    );
    if (!seriesRow) throw new Error(`Series not found: ${ruler.seriesKey}`);
    const image = imagesBySeries.get(ruler.seriesKey)?.find(
      (candidate) => candidate.fileName === ruler.fileName,
    );
    if (!image) throw new Error(`Image not found: ${ruler.fileName}`);

    const existingRows = await convex.query(
      api.imageAnnotations.listForSeries,
      {
        siteSlug: SITE_SLUG,
        seriesKey: ruler.seriesKey,
      },
    );
    const existing = existingRows.find((row) => row.imagePath === image.path);
    const annotation = {
      id: ruler.id,
      kind: "ruler" as const,
      x: ruler.x,
      y: ruler.y,
      endX: ruler.endX,
      endY: ruler.endY,
      worldStart: [...ruler.worldStart],
      worldEnd: [...ruler.worldEnd],
      text: ruler.text,
      color: "#f59e0b",
      thickness: 3,
      fontSize: 22,
    };
    const annotations = [
      ...(existing?.annotations ?? []).filter(
        (candidate) => candidate.id !== ruler.id,
      ),
      annotation,
    ];

    console.log(
      `${WRITE ? "Seeding" : "Would seed"} ${ruler.id} on ${image.path}`,
    );
    if (!WRITE) continue;
    await convex.mutation(api.imageAnnotations.saveForImage, {
      siteSlug: SITE_SLUG,
      seriesKey: ruler.seriesKey,
      imageKey: image.path,
      imagePath: image.path,
      annotations,
    });
  }
}

await main();
